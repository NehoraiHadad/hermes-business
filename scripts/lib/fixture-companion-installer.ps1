[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$InstallDir,
  [ValidateSet('ok', 'fail', 'wrong')][string]$Mode = 'ok'
)

# fixture-companion-installer.ps1 — a HARMLESS stand-in for the trusted NSIS
# companion installer, used only by scripts/e2e-companion-nsis-contract.ps1. It
# runs as a real external process and lays down real files under an ISOLATED
# $InstallDir. It never touches a live profile, Hermes home, or the network.
#   ok    — install the named entrypoint AND a LARGER decoy exe (proves the
#           deterministic entrypoint wins, not the biggest exe).
#   fail  — write a partial file then exit non-zero (installer failure).
#   wrong — exit 0 but install a different exe name (post-install contract fails).

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

if ($Mode -eq 'fail') {
  [System.IO.File]::WriteAllBytes((Join-Path $InstallDir 'partial.exe'), ([byte[]](1..20)))
  exit 7
}
if ($Mode -eq 'wrong') {
  [System.IO.File]::WriteAllBytes((Join-Path $InstallDir 'some-other.exe'), ([byte[]](1..300)))
  exit 0
}
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'tools') | Out-Null
[System.IO.File]::WriteAllBytes((Join-Path $InstallDir 'hermes-business.exe'), ([byte[]](0..255)))
[System.IO.File]::WriteAllBytes((Join-Path $InstallDir 'tools\updater-bigger.exe'), ([byte[]](0..8191 | ForEach-Object { $_ % 256 })))
exit 0
