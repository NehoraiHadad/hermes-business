# version-gate.tests.ps1 — Hermes version-compatibility gate and CalVer-tag ->
# semver release-selection cases. Dot-sourced by scripts/test-bootstrap-lib.ps1
# and uses its shared Test-Case / Assert-True harness.

function Invoke-VersionGateTests {
  param([Parameter(Mandatory)][string]$Root)
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
  Test-Case 'the pinned map is single-sourced with hermes-compat.json' {
    $canonical = Get-Content -Raw -LiteralPath (Join-Path $Root 'hermes-compat.json') | ConvertFrom-Json
    $pins = Get-DefaultPinnedReleases
    foreach ($canonicalPin in $canonical.pinnedReleases) {
      $match = @($pins | Where-Object { $_.tag -eq $canonicalPin.tag -and $_.version -eq $canonicalPin.version })
      Assert-True ($match.Count -eq 1) "Release.ps1 pin drift for $($canonicalPin.tag) -> $($canonicalPin.version)"
    }
  }
}
