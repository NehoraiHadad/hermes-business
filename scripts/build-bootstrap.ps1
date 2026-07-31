$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$installerDirectory = Join-Path $root 'installer'
$releaseDirectory = Join-Path $root 'release'
$output = Join-Path $releaseDirectory 'Hermes-Business-Web-Setup-0.3.2.exe'
$cacheRoot = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\nsis'

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
}

$artifact = Get-Item -LiteralPath $output
if ($artifact.Length -gt 5MB) {
  throw "The web bootstrapper is unexpectedly large: $($artifact.Length) bytes."
}

$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $output
Write-Host "Built $($artifact.FullName)"
Write-Host "Size: $($artifact.Length) bytes"
Write-Host "SHA256: $($hash.Hash)"
