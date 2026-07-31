# FileOps.ps1 — single source of truth for local filesystem primitives:
# atomic copy, free loopback port discovery, and payload manifest handling.
#
# Depends on: Hashing.ps1 (Get-Sha256Hash) for the manifest checksums.

function Copy-Atomic {
  # Copies Source -> Target without ever leaving a half-written Target in place:
  # write to a unique temp sibling, then Move (rename) over the destination.
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Source,
    [Parameter(Mandatory)][string]$Target
  )
  if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw "Required payload is missing: $Source"
  }
  $targetDirectory = Split-Path -Parent $Target
  if ($targetDirectory) {
    New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
  }
  $temporaryTarget = "$Target.$PID.$([guid]::NewGuid().ToString('N').Substring(0,8)).tmp"
  try {
    Copy-Item -LiteralPath $Source -Destination $temporaryTarget -Force
    Move-Item -LiteralPath $temporaryTarget -Destination $Target -Force
  }
  finally {
    if (Test-Path -LiteralPath $temporaryTarget) {
      Remove-Item -LiteralPath $temporaryTarget -Force -ErrorAction SilentlyContinue
    }
  }
}

function Get-FreeLoopbackPort {
  # Asks the OS for an ephemeral TCP port on the loopback interface. Used by the
  # health-check / test harness to avoid colliding with a busy port.
  [CmdletBinding()]
  param()
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try {
    return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  }
  finally {
    $listener.Stop()
  }
}

function Get-PayloadManifest {
  # Builds an ordered manifest (relative path -> size + sha256) for a list of
  # required files under a payload root. Fails closed if any file is absent, so
  # an incomplete payload is caught before we touch the target Hermes install.
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$PayloadRoot,
    [Parameter(Mandatory)][string[]]$RelativePaths
  )
  if (-not (Test-Path -LiteralPath $PayloadRoot -PathType Container)) {
    throw "Payload root does not exist: $PayloadRoot"
  }
  $entries = [ordered]@{}
  $missing = @()
  foreach ($relative in $RelativePaths) {
    $full = Join-Path $PayloadRoot $relative
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
      $missing += $relative
      continue
    }
    $entries[$relative] = [ordered]@{
      size = (Get-Item -LiteralPath $full).Length
      sha256 = Get-Sha256Hash -Path $full
    }
  }
  if ($missing.Count -gt 0) {
    throw "The payload is incomplete; missing file(s): $($missing -join ', ')"
  }
  return $entries
}
