$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$installerDirectory = Join-Path $root 'installer'
$releaseDirectory = Join-Path $root 'release'
$output = Join-Path $releaseDirectory 'Hermes-Business-Web-Setup-0.3.3.exe'
$manifestPath = Join-Path $installerDirectory 'companion-release.json'
$cacheRoot = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\nsis'
$companionUrl = [string]$env:HERMES_BUSINESS_COMPANION_URL
$companionSha256 = ([string]$env:HERMES_BUSINESS_COMPANION_SHA256).Trim().ToUpperInvariant()
# The NSIS companion is resolved DETERMINISTICALLY from a manifest 'entrypoint'
# (never a filesystem scan). Default to electron-builder's installed app exe
# (single-sourced from package.json's productName) so the manifest can never name
# a different binary than the one the trusted installer actually lays down.
$companionEntrypoint = [string]$env:HERMES_BUSINESS_COMPANION_ENTRYPOINT
if ([string]::IsNullOrWhiteSpace($companionEntrypoint)) {
  $pkg = Get-Content -Raw -LiteralPath (Join-Path $root 'package.json') | ConvertFrom-Json
  $companionEntrypoint = "$([string]$pkg.productName).exe"
}

if ([string]::IsNullOrWhiteSpace($companionUrl) -or $companionUrl -notmatch '^https://') {
  throw 'Set HERMES_BUSINESS_COMPANION_URL to the published HTTPS installer URL.'
}
if ($companionSha256 -notmatch '^[0-9A-F]{64}$') {
  throw 'Set HERMES_BUSINESS_COMPANION_SHA256 to the published installer SHA-256.'
}

[ordered]@{
  version = '0.3.3'
  url = $companionUrl
  sha256 = $companionSha256
  entrypoint = $companionEntrypoint
} | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding UTF8

New-Item -ItemType Directory -Force -Path $releaseDirectory | Out-Null
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File (Join-Path $PSScriptRoot 'verify-bootstrap.ps1')
if ($LASTEXITCODE -ne 0) {
  throw "Bootstrap verification failed with exit code $LASTEXITCODE."
}

$makeNsis = Get-Command makensis.exe -ErrorAction SilentlyContinue
if ($makeNsis) {
  $makeNsisPath = $makeNsis.Source
}
else {
  $makeNsisPath = Get-ChildItem -Path $cacheRoot -Filter makensis.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '[\\/]Bin[\\/]makensis\.exe$' } |
    Select-Object -First 1 -ExpandProperty FullName
}

if (-not $makeNsisPath -or -not (Test-Path -LiteralPath $makeNsisPath)) {
  throw 'makensis.exe was not found. Run npm install once so electron-builder can provide NSIS.'
}

Push-Location $installerDirectory
try {
  & $makeNsisPath '/V2' 'business-bootstrap.nsi'
  if ($LASTEXITCODE -ne 0) {
    throw "NSIS failed with exit code $LASTEXITCODE."
  }
}
finally {
  Pop-Location
  if (Test-Path -LiteralPath $manifestPath) {
    Remove-Item -LiteralPath $manifestPath -Force
  }
}

$artifact = Get-Item -LiteralPath $output
if ($artifact.Length -gt 5MB) {
  throw "The web bootstrapper is unexpectedly large: $($artifact.Length) bytes."
}

$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $output
Write-Host "Built $($artifact.FullName)"
Write-Host "Size: $($artifact.Length) bytes"
Write-Host "SHA256: $($hash.Hash)"
