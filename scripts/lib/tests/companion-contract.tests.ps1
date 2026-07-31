# companion-contract.tests.ps1 — companion release-manifest contract (format /
# checksum / HTTPS / version-range / install-root) cases, all offline. Dot-sourced
# by scripts/test-bootstrap-lib.ps1 and uses its shared Test-Case / Assert-True
# harness.

function Invoke-CompanionContractTests {
  param([Parameter(Mandatory)][string]$WorkRoot, [Parameter(Mandatory)][string]$ValidSha)
  Write-Host 'Companion release contract:'

  Test-Case 'valid manifest defaults to nsis format' {
    $r = Assert-CompanionRelease -Release ([pscustomobject]@{ version = '0.3.3'; url = 'https://x/y.exe'; sha256 = $ValidSha })
    Assert-True ($r.format -eq 'nsis') "expected default nsis, got $($r.format)"
  }
  Test-Case 'valid manifest accepts explicit zip format' {
    $r = Assert-CompanionRelease -Release ([pscustomobject]@{ version = '0.3.3'; url = 'https://x/y.zip'; sha256 = $ValidSha; format = 'ZIP'; entrypoint = 'hermes-business.exe' })
    Assert-True ($r.format -eq 'zip') "zip format not normalized: $($r.format)"
  }
  Test-Case 'unknown format is rejected' {
    $threw = $false
    try { Assert-CompanionRelease -Release ([pscustomobject]@{ version = '0.3.3'; url = 'https://x/y'; sha256 = $ValidSha; format = 'msi' }) | Out-Null }
    catch { $threw = $true; Assert-True ($_.Exception.Message -match 'Unsupported.*format') "unexpected: $($_.Exception.Message)" }
    Assert-True $threw 'an unknown format was accepted'
  }
  Test-Case 'missing SHA-256 is rejected' {
    $threw = $false
    try { Assert-CompanionRelease -Release ([pscustomobject]@{ version = '0.3.3'; url = 'https://x/y'; sha256 = '' }) | Out-Null }
    catch { $threw = $true; Assert-True ($_.Exception.Message -match 'SHA-256') "unexpected: $($_.Exception.Message)" }
    Assert-True $threw 'a manifest without a checksum was accepted'
  }
  Test-Case 'plain-HTTP URL rejected without the insecure override' {
    $threw = $false
    try { Assert-CompanionRelease -Release ([pscustomobject]@{ version = '0.3.3'; url = 'http://127.0.0.1:1/y'; sha256 = $ValidSha }) | Out-Null }
    catch { $threw = $true; Assert-True ($_.Exception.Message -match 'HTTPS') "unexpected: $($_.Exception.Message)" }
    Assert-True $threw 'a plain-HTTP URL was accepted without override'
  }
  Test-Case 'loopback HTTP allowed only with the insecure override' {
    $r = Assert-CompanionRelease -Release ([pscustomobject]@{ version = '0.3.3'; url = 'http://127.0.0.1:1/y'; sha256 = $ValidSha }) -AllowInsecureUrl
    Assert-True ($r.uri.IsLoopback) 'loopback override did not resolve'
  }
  Test-Case 'out-of-range companion version is rejected' {
    $threw = $false
    try { Assert-CompanionRelease -Release ([pscustomobject]@{ version = '0.4.0'; url = 'https://x/y'; sha256 = $ValidSha }) | Out-Null }
    catch { $threw = $true; Assert-True ($_.Exception.Message -match 'outside the tested range') "unexpected: $($_.Exception.Message)" }
    Assert-True $threw 'an out-of-range companion version was accepted'
  }
  Test-Case 'install root is injectable and never defaults into the profile in tests' {
    $isolated = Join-Path $WorkRoot 'iso-install'
    New-Item -ItemType Directory -Force -Path $isolated | Out-Null
    [System.IO.File]::WriteAllBytes((Join-Path $isolated 'hermes-business.exe'), ([byte[]](1..200)))
    $found = Get-CompanionExecutable -InstallRoot $isolated
    Assert-True ($found -and $found.StartsWith([System.IO.Path]::GetFullPath($isolated))) "exe not resolved from the isolated root: $found"
  }
}
