$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$bootstrap = Join-Path $root 'installer\bootstrap.ps1'
$source = Get-Content -Raw -LiteralPath $bootstrap
$null = [scriptblock]::Create($source)

$output = & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File $bootstrap `
  -ResolveOnly 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Bootstrap release resolution failed:`n$($output -join "`n")"
}
$jsonLine = @($output | ForEach-Object { [string]$_ } | Where-Object { $_.Trim().StartsWith('{') }) |
  Select-Object -Last 1
if (-not $jsonLine) {
  throw "Bootstrap did not return release metadata:`n$($output -join "`n")"
}
$release = $jsonLine | ConvertFrom-Json
$version = [version]$release.version
if ($version -lt [version]'0.19.0' -or $version -ge [version]'0.20.0') {
  throw "Bootstrap selected incompatible Hermes $version."
}
if ([string]::IsNullOrWhiteSpace([string]$release.tag)) {
  throw 'Bootstrap selected a release without an immutable tag.'
}

$isolationRoot = Join-Path $root ".tmp-hermes-home\bootstrap-isolation-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $isolationRoot | Out-Null
try {
  $previousErrorPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $isolationOutput = & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File $bootstrap `
    -PayloadRoot $root `
    -HermesHome $isolationRoot `
    -SkipHermesInstall `
    -SkipGatewaySetup `
    -NoLaunch 2>&1
  $isolationExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorPreference
  if ($isolationExitCode -eq 0) {
    throw 'An explicit empty HermesHome incorrectly reused a global Hermes installation.'
  }
  if (($isolationOutput -join "`n") -notmatch 'Hermes is not installed') {
    throw "The isolated missing-Hermes branch returned an unexpected error:`n$($isolationOutput -join "`n")"
  }
}
finally {
  $ErrorActionPreference = 'Stop'
  if (Test-Path -LiteralPath $isolationRoot) {
    Remove-Item -LiteralPath $isolationRoot -Recurse -Force
  }
}

Write-Host "Bootstrap parser, explicit-home isolation, and live compatible-release resolution passed: $($release.name) [$($release.tag)]."
