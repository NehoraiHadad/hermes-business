# ReleaseSelection.ps1 — the "which official release do we install?" half of the
# release contract. Resolves the AUTHORITATIVE package version per candidate tag
# (source __version__, never the CalVer tag) and picks the newest-published tag
# whose version lands in the tested range. Loaded via the Release.ps1 facade.
#
# Depends on: Logging.ps1 (Write-Step), HttpRetry.ps1 (Invoke-HttpJson),
# HermesEnv.ps1 (Test-HermesVersionCompatible). Blob acquisition/verification and
# the install orchestration live in ReleaseAcquisition.ps1.

# Pinned tag -> installed __version__ map, under OUR control. Release TAGS are
# CalVer (vYYYY.M.D) and carry no semver meaning; this records the authoritative
# package version each verified tag installs. Single-sourced with
# hermes-compat.json (the JS drift test asserts lockstep). Used as a fail-closed
# OFFLINE fallback when the per-tag source read is unavailable (rate-limit /
# transient), so selection never silently degrades to parsing a CalVer tag.
function Get-DefaultPinnedReleases {
  return @(
    [pscustomobject]@{ tag = 'v2026.8.13'; version = '0.20.1' },
    [pscustomobject]@{ tag = 'v2026.7.30'; version = '0.19.1' },
    [pscustomobject]@{ tag = 'v2026.7.20'; version = '0.19.0' },
    [pscustomobject]@{ tag = 'v2026.6.19'; version = '0.17.0' }
  )
}

function Get-ReleaseSourceVersion {
  # AUTHORITATIVE version resolution: the semver a release installs is
  # `__version__` in hermes_cli/__init__.py at that immutable tag — exactly what
  # `hermes --version` reports afterward. The release TAG (CalVer vYYYY.M.D) is
  # NEVER parsed as the package version, and release prose is never scraped.
  # Returns [version], or $null when unresolvable (caller skips that release).
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Repository,
    [Parameter(Mandatory)][string]$Tag,
    [Parameter(Mandatory)][hashtable]$Headers,
    [object[]]$PinnedReleases,
    [string]$ApiBase = 'https://api.github.com'
  )
  try {
    $encodedTag = [uri]::EscapeDataString($Tag)
    $meta = Invoke-HttpJson `
      -Uri "$ApiBase/repos/$Repository/contents/hermes_cli/__init__.py`?ref=$encodedTag" `
      -Headers $Headers `
      -Description "version source for $Tag"
    if ($meta.encoding -eq 'base64' -and -not [string]::IsNullOrWhiteSpace([string]$meta.content)) {
      $decoded = [System.Text.Encoding]::UTF8.GetString(
        [Convert]::FromBase64String(([string]$meta.content -replace '\s', ''))
      )
      $match = [regex]::Match($decoded, '__version__\s*=\s*["'']([0-9]+\.[0-9]+\.[0-9]+)["'']')
      if ($match.Success) { return [version]$match.Groups[1].Value }
    }
  }
  catch {
    # Authoritative read failed (offline / rate-limit / moved file). Fall through
    # to the pinned fallback rather than guessing from the tag.
  }
  if ($PinnedReleases) {
    $pin = @($PinnedReleases | Where-Object { $_.tag -eq $Tag }) | Select-Object -First 1
    if ($pin) { return [version]$pin.version }
  }
  return $null
}

function Select-CompatibleRelease {
  # PURE selection (no network): the newest-published, non-draft/non-prerelease
  # release whose RESOLVED semver lands in [Minimum, Maximum). $VersionResolver
  # maps a release object -> [version] (or $null to skip it). Fails closed when
  # none qualify. Kept network-free so the deterministic bootstrap gate can prove
  # the CalVer-tag-safe selection logic offline.
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Releases,
    [Parameter(Mandatory)][version]$Minimum,
    [Parameter(Mandatory)][version]$Maximum,
    [Parameter(Mandatory)][scriptblock]$VersionResolver
  )
  $eligible = @($Releases | Where-Object { -not $_.draft -and -not $_.prerelease }) |
    Sort-Object -Property @{ Expression = { [datetimeoffset]$_.published_at }; Descending = $true }
  foreach ($release in $eligible) {
    $tag = [string]$release.tag_name
    if ($tag -notmatch '^v?[0-9][0-9A-Za-z.-]+$') { continue }
    $version = & $VersionResolver $release
    if ($null -eq $version) { continue }
    if (Test-HermesVersionCompatible -Version $version -Minimum $Minimum -Maximum $Maximum) {
      return [pscustomobject]@{
        tag         = $tag
        version     = [string]$version
        name        = [string]$release.name
        publishedAt = [string]$release.published_at
      }
    }
  }
  throw "No compatible official Hermes release was found in [$Minimum, $Maximum). Refusing to install an untested version."
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
  # Fails closed: fetches the release list, then selects the newest-published
  # release whose AUTHORITATIVE source __version__ lands in [Minimum, Maximum).
  # The CalVer tag is never treated as a version; source read falls back to the
  # pinned manifest. If none qualify we throw rather than install anything
  # untested.
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Repository,
    [Parameter(Mandatory)][version]$Minimum,
    [Parameter(Mandatory)][version]$Maximum,
    [Parameter(Mandatory)][hashtable]$Headers,
    [object[]]$PinnedReleases = (Get-DefaultPinnedReleases),
    [string]$ApiBase = 'https://api.github.com'
  )
  Write-Step "Resolving the newest official Hermes release in [$Minimum, $Maximum) by source __version__."
  $releases = Invoke-HttpJson `
    -Uri "$ApiBase/repos/$Repository/releases?per_page=100" `
    -Headers $Headers `
    -Description 'GitHub release list'

  # Captured as a VARIABLE for the same reason bootstrap-companion.ps1's zip
  # install action is: GetNewClosure() carries variables, but binds the block to a
  # fresh module session state whose command lookup falls back to GLOBAL only. A
  # bare `Get-ReleaseSourceVersion` would resolve only when installer/lib was
  # dot-sourced globally (`-File`), and not when it landed in a child scope
  # (`-Command "& .\x.ps1"`). A command object is data, so it travels either way.
  $sourceVersionReader = Get-Command -Name 'Get-ReleaseSourceVersion' -CommandType Function
  $resolver = {
    param($Release)
    & $sourceVersionReader `
      -Repository $Repository `
      -Tag ([string]$Release.tag_name) `
      -Headers $Headers `
      -PinnedReleases $PinnedReleases `
      -ApiBase $ApiBase
  }.GetNewClosure()

  return Select-CompatibleRelease -Releases @($releases) -Minimum $Minimum -Maximum $Maximum -VersionResolver $resolver
}
