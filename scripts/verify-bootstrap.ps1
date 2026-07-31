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

Write-Host "Bootstrap parser and live compatible-release resolution passed: $($release.name) [$($release.tag)]."
