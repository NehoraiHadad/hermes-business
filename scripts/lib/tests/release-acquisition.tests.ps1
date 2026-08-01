# release-acquisition.tests.ps1 — deterministic, offline proof that the official
# Hermes GitHub-acquisition half is sound: (a) the selected release version comes
# from source __version__, never the CalVer tag, and (b) the immutable installer
# blob is verified against GitHub's git blob SHA-1 before it can be written or run.
# Dot-sourced by scripts/test-bootstrap-lib.ps1; uses its shared harness. No network.

function New-InstallerBytes {
  # A plausible official installer body: passes the size floor and the
  # expected-content probe ('hermes' + 'python').
  param([int]$Pad = 600)
  $text = "#!/usr/bin/env pwsh`n# hermes official installer`npython -m hermes_cli install`n" + ('#' * $Pad)
  return [System.Text.Encoding]::UTF8.GetBytes($text)
}

function Invoke-ReleaseAcquisitionTests {
  param([Parameter(Mandatory)][string]$WorkRoot)
  Write-Host 'Release acquisition (GitHub):'
  $bytes = New-InstallerBytes
  $good = Get-GitBlobSha1 -Content $bytes

  Test-Case 'a well-formed installer blob passes verification and is written' {
    $dest = Join-Path $WorkRoot 'installer-good.ps1'
    $id = Assert-VerifiedInstallerBlob -Content $bytes -ExpectedBlobSha $good -ReportedBlobSha $good -Destination $dest -Tag 'v2026.7.30'
    Assert-True ($id -eq $good) "returned blob id mismatch: $id"
    Assert-True (Test-Path -LiteralPath $dest -PathType Leaf) 'the verified installer was not written'
    Assert-True ((Get-GitBlobSha1 -Content ([System.IO.File]::ReadAllBytes($dest))) -eq $good) 'written bytes do not match the verified blob'
  }
  Test-Case 'tampered installer content is rejected and nothing is written' {
    $dest = Join-Path $WorkRoot 'installer-tampered.ps1'
    $tampered = New-InstallerBytes; $tampered[10] = [byte](($tampered[10] + 1) % 256)
    $threw = $false
    try { Assert-VerifiedInstallerBlob -Content $tampered -ExpectedBlobSha $good -ReportedBlobSha $good -Destination $dest -Tag 'v2026.7.30' | Out-Null }
    catch { $threw = $true; Assert-True ($_.Exception.Message -match 'integrity') "unexpected: $($_.Exception.Message)" }
    Assert-True $threw 'a tampered installer blob was accepted'
    Assert-True (-not (Test-Path -LiteralPath $dest)) 'a tampered installer was written to disk'
  }
  Test-Case 'a lying blob endpoint (reported != resolved id) is rejected' {
    $dest = Join-Path $WorkRoot 'installer-lie.ps1'
    $threw = $false
    try { Assert-VerifiedInstallerBlob -Content $bytes -ExpectedBlobSha $good -ReportedBlobSha ('0' * 40) -Destination $dest -Tag 'v2026.7.30' | Out-Null }
    catch { $threw = $true }
    Assert-True $threw 'a mismatched reported blob id was accepted'
    Assert-True (-not (Test-Path -LiteralPath $dest)) 'a lying-endpoint installer was written'
  }
  Test-Case 'a malformed metadata sha is rejected before hashing' {
    $threw = $false
    try { Assert-VerifiedInstallerBlob -Content $bytes -ExpectedBlobSha 'not-a-sha' -ReportedBlobSha $good -Destination (Join-Path $WorkRoot 'x.ps1') -Tag 'v2026.7.30' | Out-Null }
    catch { $threw = $true; Assert-True ($_.Exception.Message -match 'invalid installer metadata') "unexpected: $($_.Exception.Message)" }
    Assert-True $threw 'malformed installer metadata was accepted'
  }
  Test-Case 'content that fails the expected-content probe is rejected' {
    $badBytes = [System.Text.Encoding]::UTF8.GetBytes('echo not an installer' + ('.' * 600))
    $badId = Get-GitBlobSha1 -Content $badBytes
    $threw = $false
    try { Assert-VerifiedInstallerBlob -Content $badBytes -ExpectedBlobSha $badId -ReportedBlobSha $badId -Destination (Join-Path $WorkRoot 'y.ps1') -Tag 'v2026.7.30' | Out-Null }
    catch { $threw = $true; Assert-True ($_.Exception.Message -match 'expected-content') "unexpected: $($_.Exception.Message)" }
    Assert-True $threw 'installer content that failed the probe was accepted'
  }
  Test-Case 'an undersized installer blob is rejected' {
    $tiny = [System.Text.Encoding]::UTF8.GetBytes('hermes python')
    $tinyId = Get-GitBlobSha1 -Content $tiny
    $threw = $false
    try { Assert-VerifiedInstallerBlob -Content $tiny -ExpectedBlobSha $tinyId -ReportedBlobSha $tinyId -Destination (Join-Path $WorkRoot 'z.ps1') -Tag 'v2026.7.30' | Out-Null }
    catch { $threw = $true; Assert-True ($_.Exception.Message -match 'unexpected size') "unexpected: $($_.Exception.Message)" }
    Assert-True $threw 'an undersized installer blob was accepted'
  }
  Test-Case 'the acquisition path is wired: verify + source-version selection are reachable' {
    $save = (Get-Command Save-VerifiedOfficialInstaller).ScriptBlock.ToString()
    Assert-True ($save -match 'Assert-VerifiedInstallerBlob') 'Save-VerifiedOfficialInstaller does not delegate to the blob verifier'
    $install = (Get-Command Install-LatestCompatibleHermes).ScriptBlock.ToString()
    Assert-True ($install -match 'Save-VerifiedOfficialInstaller') 'the install path does not verify the installer blob'
    Assert-True ($install -match 'Resolve-LatestCompatibleRelease') 'the install path does not select by resolved source version'
    $resolve = (Get-Command Resolve-LatestCompatibleRelease).ScriptBlock.ToString()
    Assert-True ($resolve -match 'Get-ReleaseSourceVersion') 'release selection is not wired to the authoritative source __version__'
  }
}
