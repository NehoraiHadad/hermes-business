function Invoke-NativeCommandTests {
  param([string]$WorkRoot)
  $command = Join-Path $WorkRoot 'native warning.cmd'
  Set-Content -LiteralPath $command -Encoding Ascii -Value @'
@echo off
echo dependency lock still held after 10.0s; continuing without it 1>&2
echo Hermes 0.22.2
if "%1"=="--version" exit /b 0
exit /b %1
'@
  Test-Case 'native warning preserves stdout and succeeds under Stop' {
    $result = Invoke-NativeCommand -FilePath $command -Arguments @('0')
    Assert-True ($result.ExitCode -eq 0) 'warning became failure'
    Assert-True ($result.Stdout -eq 'Hermes 0.22.2') 'stderr contaminated stdout'
    Assert-True ($result.Stderr -match 'dependency lock still held') 'diagnostic was lost'
    Assert-True ($ErrorActionPreference -eq 'Stop') 'caller error policy changed'
  }
  Test-Case 'version check tolerates native warning and parses only stdout' {
    $version = Get-HermesVersion -HermesExe $command
    Assert-True ($version.raw -eq '0.22.2') 'wrong version parsed'
  }
  Test-Case 'nonzero native exit remains failure even with valid version output' {
    $result = Invoke-NativeCommand -FilePath $command -Arguments @('7')
    Assert-True ($result.ExitCode -eq 7) 'exit code lost'
    $failed = Join-Path $WorkRoot 'native failure.cmd'
    Set-Content -LiteralPath $failed -Encoding Ascii -Value "@echo off`r`necho Hermes 0.22.2`r`nexit /b 7"
    $threw = $false
    try { Get-HermesVersion -HermesExe $failed | Out-Null } catch { $threw = $true }
    Assert-True $threw 'failed version command accepted'
  }
}
