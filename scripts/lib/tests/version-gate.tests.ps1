# version-gate.tests.ps1 — Hermes version-compatibility gate and CalVer-tag ->
# semver release-selection cases. Dot-sourced by scripts/test-bootstrap-lib.ps1
# and uses its shared Test-Case / Assert-True harness.

function Invoke-VersionGateTests {
  param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$WorkRoot)
  Write-Host 'Version gate:'

  Test-Case 'incompatible (too new) version fails closed with guidance' {
    $threw = $false
    try {
      Assert-CompatibleVersion -Version ([version]'0.21.0') -Minimum ([version]'0.19.0') -Maximum ([version]'0.20.0')
    }
    catch {
      $threw = $true
      Assert-True ($_.Exception.Message -match 'left (it )?untouched|untouched') 'no preserve-existing guidance in incompatible error'
    }
    Assert-True $threw 'an out-of-range version was accepted'
  }
  Test-Case 'compatible version passes the gate' {
    Assert-CompatibleVersion -Version ([version]'0.19.5') -Minimum ([version]'0.19.0') -Maximum ([version]'0.20.0')
  }
  Test-Case 'release version comes from source __version__, never the CalVer tag' {
    # Real upstream tags are CalVer (vYYYY.M.D); the authoritative semver lives in
    # hermes_cli/__init__.py. Selection must resolve via a source read, so a
    # CalVer tag like v2026.7.30 maps to its true installed version 0.19.1.
    $releases = @(
      [pscustomobject]@{ tag_name = 'v2026.7.31'; name = 'Next'; published_at = '2026-07-31T00:00:00Z'; draft = $false; prerelease = $false },
      [pscustomobject]@{ tag_name = 'v2026.7.30'; name = 'Stable'; published_at = '2026-07-30T00:00:00Z'; draft = $false; prerelease = $false },
      [pscustomobject]@{ tag_name = 'v2026.7.20'; name = 'Prev'; published_at = '2026-07-20T00:00:00Z'; draft = $false; prerelease = $false }
    )
    # Deterministic resolver standing in for the source read: the NEWEST release
    # is a future 0.20.0 (out of range) and must be skipped in favour of 0.19.1.
    $sourceVersions = @{ 'v2026.7.31' = '0.20.0'; 'v2026.7.30' = '0.19.1'; 'v2026.7.20' = '0.19.0' }
    $resolver = { param($Release) [version]$sourceVersions[[string]$Release.tag_name] }
    $selected = Select-CompatibleRelease -Releases $releases -Minimum ([version]'0.19.0') -Maximum ([version]'0.20.0') -VersionResolver $resolver
    Assert-True ($selected.tag -eq 'v2026.7.30') "expected v2026.7.30, got $($selected.tag)"
    Assert-True ($selected.version -eq '0.19.1') "expected resolved version 0.19.1, got $($selected.version)"
  }
  Test-Case 'a CalVer tag is never mistaken for a semver version' {
    # If the selector fell back to parsing the tag, v2026.7.30 would read as
    # 2026.7.30 and be rejected as out-of-range. Prove it does NOT.
    $releases = @(
      [pscustomobject]@{ tag_name = 'v2026.7.30'; name = 'Stable'; published_at = '2026-07-30T00:00:00Z'; draft = $false; prerelease = $false }
    )
    $resolver = { param($Release) [version]'0.19.1' }
    $selected = Select-CompatibleRelease -Releases $releases -Minimum ([version]'0.19.0') -Maximum ([version]'0.20.0') -VersionResolver $resolver
    Assert-True ($selected.version -eq '0.19.1') "CalVer tag leaked into version resolution: $($selected.version)"
  }
  Test-Case 'Get-ReleaseSourceVersion falls back to the pinned map when the read fails' {
    # No network here: the source read throws (bad ApiBase), so the pinned manifest
    # under our control must supply the authoritative version.
    $pins = Get-DefaultPinnedReleases
    $v = Get-ReleaseSourceVersion -Repository 'NousResearch/hermes-agent' -Tag 'v2026.7.30' `
      -Headers @{ 'User-Agent' = 'test' } -PinnedReleases $pins -ApiBase 'http://127.0.0.1:9'
    Assert-True ($v -eq [version]'0.19.1') "expected pinned 0.19.1, got $v"
  }
  Test-Case 'selection fails closed when no release is in range' {
    $releases = @(
      [pscustomobject]@{ tag_name = 'v2026.6.19'; name = 'Old'; published_at = '2026-06-19T00:00:00Z'; draft = $false; prerelease = $false }
    )
    $resolver = { param($Release) [version]'0.17.0' }
    $threw = $false
    try {
      Select-CompatibleRelease -Releases $releases -Minimum ([version]'0.19.0') -Maximum ([version]'0.20.0') -VersionResolver $resolver | Out-Null
    }
    catch { $threw = $true }
    Assert-True $threw 'an all-incompatible release list was not rejected'
  }
  # Opt-in GitHub Authorization. Resolve-LatestCompatibleRelease is a 1+N caller
  # (release list, then one source read per candidate tag), so the anonymous
  # 60/hr-per-IP budget is what flakes on a shared runner; a token buys 1000/hr.
  # Both halves of that bargain are pinned here: the token is used when present,
  # and an end user - who has none - keeps the exact headers we always sent.
  # Every case saves and restores BOTH variables so the suite leaks no state,
  # and no assertion message ever interpolates a token value.
  $restoreToken = {
    param([string]$Name, $Value)
    # SetEnvironmentVariable(...,'Process') is the $env: drive itself, and it
    # deletes on $null/empty - which Set-Item cannot express.
    [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
  }

  Test-Case 'no token in the environment leaves the API headers unchanged' {
    $savedGithub = $env:GITHUB_TOKEN
    $savedGh = $env:GH_TOKEN
    try {
      & $restoreToken 'GITHUB_TOKEN' $null
      & $restoreToken 'GH_TOKEN' $null
      $headers = Get-GitHubApiHeaders -UserAgent 'gate-test'
      Assert-True ($headers.Count -eq 2) "expected exactly the 2 original headers, got: $(($headers.Keys | Sort-Object) -join ', ')"
      Assert-True ($headers['User-Agent'] -eq 'gate-test') 'the User-Agent header changed for a tokenless caller'
      Assert-True ($headers['Accept'] -eq 'application/vnd.github+json') 'the Accept header changed for a tokenless caller'
      Assert-True (-not $headers.ContainsKey('Authorization')) 'an Authorization header was sent with no token present'
    }
    finally {
      & $restoreToken 'GITHUB_TOKEN' $savedGithub
      & $restoreToken 'GH_TOKEN' $savedGh
    }
  }
  Test-Case 'GITHUB_TOKEN adds a Bearer Authorization header' {
    $savedGithub = $env:GITHUB_TOKEN
    $savedGh = $env:GH_TOKEN
    try {
      & $restoreToken 'GITHUB_TOKEN' 'primary-token'
      & $restoreToken 'GH_TOKEN' 'fallback-token'
      $headers = Get-GitHubApiHeaders -UserAgent 'gate-test'
      # GITHUB_TOKEN wins: it is what Actions injects, so a developer machine
      # with a stale gh login cannot override what CI deliberately passed.
      Assert-True ($headers['Authorization'] -eq 'Bearer primary-token') 'GITHUB_TOKEN did not produce the expected Bearer header'
      Assert-True ($headers.Count -eq 3) 'the token path changed more than the Authorization header'
    }
    finally {
      & $restoreToken 'GITHUB_TOKEN' $savedGithub
      & $restoreToken 'GH_TOKEN' $savedGh
    }
  }
  Test-Case 'GH_TOKEN is the fallback when GITHUB_TOKEN is absent' {
    $savedGithub = $env:GITHUB_TOKEN
    $savedGh = $env:GH_TOKEN
    try {
      & $restoreToken 'GITHUB_TOKEN' $null
      & $restoreToken 'GH_TOKEN' 'fallback-token'
      $headers = Get-GitHubApiHeaders -UserAgent 'gate-test'
      Assert-True ($headers['Authorization'] -eq 'Bearer fallback-token') 'GH_TOKEN was not used as the fallback token source'
    }
    finally {
      & $restoreToken 'GITHUB_TOKEN' $savedGithub
      & $restoreToken 'GH_TOKEN' $savedGh
    }
  }
  Test-Case 'a whitespace-only token counts as absent, never as `Bearer `' {
    # An empty `env:` entry in a workflow is the realistic source of this. Sending
    # a bare Bearer would turn a working anonymous request into a hard 401.
    $savedGithub = $env:GITHUB_TOKEN
    $savedGh = $env:GH_TOKEN
    try {
      & $restoreToken 'GITHUB_TOKEN' "  `t "
      & $restoreToken 'GH_TOKEN' '   '
      $headers = Get-GitHubApiHeaders -UserAgent 'gate-test'
      Assert-True (-not $headers.ContainsKey('Authorization')) 'a whitespace-only token produced an Authorization header'
      Assert-True ($headers.Count -eq 2) 'a whitespace-only token changed the tokenless header set'
    }
    finally {
      & $restoreToken 'GITHUB_TOKEN' $savedGithub
      & $restoreToken 'GH_TOKEN' $savedGh
    }
  }
  Test-Case 'no caller ever logs the API headers' {
    # The token only stays a secret while nothing prints the hashtable that holds
    # it. Assert that at the seam, not by eye: every module that receives
    # -Headers must keep it out of Write-Step/Write-Host/Write-Output.
    foreach ($module in @('ReleaseSelection.ps1', 'ReleaseAcquisition.ps1', 'VerifyMode.ps1', 'HttpRetry.ps1', 'HttpDownload.ps1')) {
      $text = Get-Content -Raw -LiteralPath (Join-Path $Root "installer\lib\$module")
      Assert-True (-not ($text -match '(?i)Write-(Step|Host|Output|Warning)[^\r\n]*\$(Headers|headers|token|Token)\b')) `
        "a logging call in $module interpolates the request headers or a token"
    }
  }
  Test-Case 'the resolver closure still reaches Get-ReleaseSourceVersion from a CHILD scope' {
    # REGRESSION, same trap as bootstrap-companion.ps1's zip install action:
    # Resolve-LatestCompatibleRelease hands Select-CompatibleRelease a
    # GetNewClosure() resolver, and a closure resolves commands through its own
    # module scope -> GLOBAL only. A bare `Get-ReleaseSourceVersion` therefore
    # works only while installer/lib sits in the global scope, which
    # `powershell.exe -File x.ps1` arranges and `-Command "& .\x.ps1"` does not.
    # Every caller today (and this suite) uses -File, so the child process below
    # is the only way to see it.
    $caseRoot = Join-Path $WorkRoot 'resolver-child-scope'
    New-Item -ItemType Directory -Force -Path $caseRoot | Out-Null
    $probeScript = Join-Path $caseRoot 'resolver-probe.ps1'
    Set-Content -LiteralPath $probeScript -Encoding ascii -Value @'
param([string]$RepoRoot)
$ErrorActionPreference = 'Stop'
foreach ($m in @('Logging.ps1', 'Hashing.ps1', 'HttpRetry.ps1', 'HttpDownload.ps1', 'SemVer.ps1', 'HermesEnv.ps1', 'Release.ps1')) {
  . (Join-Path $RepoRoot "installer\lib\$m")
}
# Offline stand-in for BOTH network reads, shadowing the real one after load: the
# release list is served locally, and the per-tag source read throws so
# Get-ReleaseSourceVersion takes its pinned fallback. Nothing reaches GitHub.
function Invoke-HttpJson {
  param($Uri, $Headers, $Description)
  if ($Description -eq 'GitHub release list') {
    return @([pscustomobject]@{ tag_name = 'v2026.7.30'; name = 'Stable'; published_at = '2026-07-30T00:00:00Z'; draft = $false; prerelease = $false })
  }
  throw 'offline by design'
}
$selected = Resolve-LatestCompatibleRelease -Repository 'nous/hermes' -Minimum ([version]'0.19.0') -Maximum ([version]'0.20.0') -Headers @{}
if ($selected.version -ne '0.19.1') { throw "the probe resolved the wrong version: $($selected.version)" }
Write-Output 'PROBE-OK'
'@
    $stdout = Join-Path $caseRoot 'probe.out'
    $stderr = Join-Path $caseRoot 'probe.err'
    # -Command, NOT -File: that is the entry form under test. Redirected to files
    # so the child's stderr cannot trip the parent's ErrorActionPreference='Stop'.
    $child = Start-Process -FilePath $powershell -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ('& "{0}" -RepoRoot "{1}"' -f $probeScript, $Root))
    $output = ((Get-Content -Raw -LiteralPath $stdout) + (Get-Content -Raw -LiteralPath $stderr))
    Assert-True ($output -notmatch 'is not recognized') "the resolver closure lost a dot-sourced helper in a child scope: $output"
    Assert-True ($child.ExitCode -eq 0) "the -Command entry failed with exit $($child.ExitCode): $output"
    Assert-True ($output -match 'PROBE-OK') "the probe did not resolve a release: $output"
  }
  Test-Case 'the pinned map is single-sourced with hermes-compat.json' {
    $canonical = Get-Content -Raw -LiteralPath (Join-Path $Root 'hermes-compat.json') | ConvertFrom-Json
    $pins = Get-DefaultPinnedReleases
    foreach ($canonicalPin in $canonical.pinnedReleases) {
      $match = @($pins | Where-Object { $_.tag -eq $canonicalPin.tag -and $_.version -eq $canonicalPin.version })
      Assert-True ($match.Count -eq 1) "Release.ps1 pin drift for $($canonicalPin.tag) -> $($canonicalPin.version)"
    }
  }
}
