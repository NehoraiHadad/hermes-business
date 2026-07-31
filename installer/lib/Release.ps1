# Release.ps1 — single source of truth for choosing and fetching the official,
# tagged Hermes release. This bootstrap NEVER bundles Hermes: it either detects
# an existing compatible install or downloads the newest official tagged release
# inside the tested version range and runs the official installer verbatim.
#
# Depends on: Logging.ps1, Http.ps1 (Invoke-HttpJson), Hashing.ps1 (blob SHA-1,
# SHA-256), HermesEnv.ps1 (Test-HermesVersionCompatible).

# Pinned tag -> installed __version__ map, under OUR control. Release TAGS are
# CalVer (vYYYY.M.D) and carry no semver meaning; this records the authoritative
# package version each verified tag installs. Single-sourced with
# hermes-compat.json (the JS drift test asserts lockstep). Used as a fail-closed
# OFFLINE fallback when the per-tag source read is unavailable (rate-limit /
# transient), so selection never silently degrades to parsing a CalVer tag.
function Get-DefaultPinnedReleases {
  return @(
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
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$UserAgent)
  return @{
    'User-Agent' = $UserAgent
    'Accept'     = 'application/vnd.github+json'
  }
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

  $resolver = {
    param($Release)
    Get-ReleaseSourceVersion `
      -Repository $Repository `
      -Tag ([string]$Release.tag_name) `
      -Headers $Headers `
      -PinnedReleases $PinnedReleases `
      -ApiBase $ApiBase
  }.GetNewClosure()

  return Select-CompatibleRelease -Releases @($releases) -Minimum $Minimum -Maximum $Maximum -VersionResolver $resolver
}

function Save-VerifiedOfficialInstaller {
  # Downloads scripts/install.ps1 pinned to an immutable tag via the GitHub
  # Contents/Blobs API and verifies it against the git blob SHA-1 GitHub
  # advertises, so a tampered mirror or MITM cannot substitute a payload.
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Repository,
    [Parameter(Mandatory)][string]$Tag,
    [Parameter(Mandatory)][string]$Destination,
    [Parameter(Mandatory)][hashtable]$Headers
  )
  $path = 'scripts/install.ps1'
  $encodedTag = [uri]::EscapeDataString($Tag)
  $metadata = Invoke-HttpJson `
    -Uri "https://api.github.com/repos/$Repository/contents/$path`?ref=$encodedTag" `
    -Headers $Headers `
    -Description "installer metadata for $Tag"
  $expectedBlobSha = ([string]$metadata.sha).ToLowerInvariant()
  if ($metadata.type -ne 'file' -or $expectedBlobSha -notmatch '^[0-9a-f]{40}$') {
    throw "GitHub returned invalid installer metadata for $Tag."
  }

  $blob = Invoke-HttpJson `
    -Uri "https://api.github.com/repos/$Repository/git/blobs/$expectedBlobSha" `
    -Headers $Headers `
    -Description "installer blob for $Tag"
  if ($blob.encoding -ne 'base64' -or [string]::IsNullOrWhiteSpace([string]$blob.content)) {
    throw "GitHub returned an unsupported installer blob for $Tag."
  }
  try {
    [byte[]]$installerBytes = [Convert]::FromBase64String(([string]$blob.content -replace '\s', ''))
  }
  catch {
    throw "GitHub returned malformed installer content for $Tag."
  }
  $actualBlobSha = Get-GitBlobSha1 -Content $installerBytes
  if ($actualBlobSha -ne $expectedBlobSha -or ([string]$blob.sha).ToLowerInvariant() -ne $expectedBlobSha) {
    throw "The official installer failed git blob integrity verification for $Tag."
  }
  [System.IO.File]::WriteAllBytes($Destination, $installerBytes)
  $installerInfo = Get-Item -LiteralPath $Destination
  if ($installerInfo.Length -lt 500 -or $installerInfo.Length -gt 2MB) {
    throw "The downloaded installer has an unexpected size: $($installerInfo.Length) bytes."
  }
  $installerText = Get-Content -Raw -LiteralPath $Destination
  if ($installerText -notmatch 'hermes' -or $installerText -notmatch 'python') {
    throw 'The downloaded installer did not pass the expected-content check.'
  }
  return $expectedBlobSha
}

function Install-LatestCompatibleHermes {
  # Detect-then-download flow entry point: pick the newest compatible tagged
  # release, verify+run the official installer into $HermesHome, and confirm the
  # expected hermes.exe was produced. Never bundles or vendors Hermes.
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Repository,
    [Parameter(Mandatory)][version]$Minimum,
    [Parameter(Mandatory)][version]$Maximum,
    [Parameter(Mandatory)][string]$HermesHome,
    [Parameter(Mandatory)][hashtable]$Headers
  )
  Write-Step 'Hermes was not found; downloading the newest compatible official release.'
  $release = Resolve-LatestCompatibleRelease -Repository $Repository -Minimum $Minimum -Maximum $Maximum -Headers $Headers
  $tag = [string]$release.tag
  Write-Step "Selected $($release.name) at immutable tag $tag."

  $temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "hermes-business-$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Force -Path $temporaryDirectory | Out-Null
  try {
    $installerPath = Join-Path $temporaryDirectory 'install.ps1'
    Write-Step "Downloading and verifying the official installer blob for $tag."
    $installerBlobSha = Save-VerifiedOfficialInstaller -Repository $Repository -Tag $tag -Destination $installerPath -Headers $Headers
    Write-Step "Verified installer git blob: $installerBlobSha"
    Write-Step "Installer SHA256: $(Get-Sha256Hash -Path $installerPath)"

    $stdoutPath = Join-Path $temporaryDirectory 'installer.stdout.log'
    $stderrPath = Join-Path $temporaryDirectory 'installer.stderr.log'
    $process = Start-Process `
      -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
      -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', ('"{0}"' -f $installerPath),
        '-Tag', $tag,
        '-HermesHome', ('"{0}"' -f $HermesHome),
        '-InstallDir', ('"{0}"' -f (Join-Path $HermesHome 'hermes-agent')),
        '-NonInteractive',
        '-Json',
        '-IncludeDesktop'
      ) `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath `
      -WindowStyle Hidden `
      -PassThru `
      -Wait
    $installerOutput = @(
      (Get-Content -Raw -LiteralPath $stdoutPath -ErrorAction SilentlyContinue),
      (Get-Content -Raw -LiteralPath $stderrPath -ErrorAction SilentlyContinue)
    ) -join "`n"
    if ($installerOutput.Length -gt 6000) {
      $installerOutput = $installerOutput.Substring($installerOutput.Length - 6000)
    }
    if ($process.ExitCode -ne 0) {
      throw "The official Hermes installer exited with code $($process.ExitCode).`n$installerOutput"
    }
    $expectedHermes = Join-Path $HermesHome 'hermes-agent\venv\Scripts\hermes.exe'
    if (-not (Test-Path -LiteralPath $expectedHermes -PathType Leaf)) {
      throw "The official Hermes installer returned success without creating $expectedHermes.`n$installerOutput"
    }
  }
  finally {
    if (Test-Path -LiteralPath $temporaryDirectory) {
      Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
    }
  }
}
