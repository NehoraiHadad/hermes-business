# The official stable SemVer release is authoritative (modern Hermes contract).
# Historical CalVer tags, drafts and prereleases cannot select an engine.
function Select-CompatibleRelease {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Releases,
    [Parameter(Mandatory)][version]$Minimum
  )
  $stable = @($Releases | Where-Object {
    -not $_.draft -and -not $_.prerelease -and
    ([string]$_.tag_name -cmatch '^v(?:0|[1-9]\d{0,2})\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$')
  } | Sort-Object -Property @{ Expression = { [datetimeoffset]$_.published_at }; Descending = $true })
  if ($stable.Count -eq 0) { throw 'No official stable Hermes release was found.' }
  $release = $stable[0]
  $version = [version]([string]$release.tag_name).Substring(1)
  if (-not (Test-HermesVersionCompatible -Version $version -Minimum $Minimum)) {
    throw "The latest official stable Hermes $version is below the required minimum $Minimum. Refusing to select an older release."
  }
  return [pscustomobject]@{
    tag = [string]$release.tag_name
    version = [string]$version
    name = [string]$release.name
    publishedAt = [string]$release.published_at
  }
}

function Get-GitHubApiHeaders {
  # Anonymous api.github.com allows 60 requests/hour PER IP, shared by everyone
  # behind it; a token raises that to 1000/hour for the token itself. That gap
  # is what matters to Resolve-LatestCompatibleRelease, which is a 1+N caller:
  # one release list, then one source read per candidate tag (up to 100 with
  # per_page=100). On a shared CI runner a single resolve can therefore exhaust
  # the anonymous budget on its own.
  #
  # Authorization is OPT-IN from the environment and nothing else: CI passes
  # github.token, an end user has none and gets exactly the two headers this
  # function has always returned, so the customer install path is unchanged.
  # The token value is never logged - no caller prints this hashtable, and no
  # error path echoes it - and that must stay true.
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$UserAgent)
  $headers = @{
    'User-Agent' = $UserAgent
    'Accept'     = 'application/vnd.github+json'
  }
  # GITHUB_TOKEN first (what Actions injects), GH_TOKEN second (what the gh CLI
  # exports locally). Whitespace-only is treated as ABSENT: an empty `env:` entry
  # in a workflow would otherwise send a bare `Bearer `, turning a working
  # anonymous request into a hard 401 - failing worse than not opting in at all.
  $token = $env:GITHUB_TOKEN
  if ([string]::IsNullOrWhiteSpace($token)) { $token = $env:GH_TOKEN }
  if (-not [string]::IsNullOrWhiteSpace($token)) {
    # Trimmed because a token read from a file keeps its trailing newline, and a
    # header value with a line break is rejected before it ever reaches GitHub.
    $headers['Authorization'] = "Bearer $($token.Trim())"
  }
  return $headers
}

function Resolve-LatestCompatibleRelease {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Repository,
    [Parameter(Mandatory)][version]$Minimum,
    [Parameter(Mandatory)][hashtable]$Headers,
    [string]$ApiBase = 'https://api.github.com'
  )
  Write-Step "Resolving the latest official stable Hermes release (minimum $Minimum, no upper ceiling)."
  $release = Invoke-HttpJson -Uri "$ApiBase/repos/$Repository/releases/latest" -Headers $Headers -Description 'latest official stable Hermes release'
  # GitHub's latest endpoint is intentional: failure or an invalid identity must
  # fail closed rather than silently selecting another release from history.
  return Select-CompatibleRelease -Releases @($release) -Minimum $Minimum
}
