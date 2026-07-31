# e2e-thin-installer-lib.ps1 — helpers for scripts/e2e-thin-network-installer.ps1.
#
# Keeps the E2E orchestrator small: artifact/zip builders (benign, malicious
# zip-slip, and a decoy-entrypoint archive) plus loopback static-server control.
# Dot-sourced by the E2E; assumes $RepoRoot is set by the caller.

Add-Type -AssemblyName System.IO.Compression | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function New-ZipFromEntries {
  # Builds a zip from raw (name -> bytes) entries. Uses ZipArchive.CreateEntry so
  # entry names can be crafted verbatim (including hostile '../' traversal names
  # that Compress-Archive would never emit).
  param([string]$Destination, [object[]]$Entries)
  if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Force }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  $archive = [System.IO.Compression.ZipFile]::Open($Destination, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($e in $Entries) {
      $entry = $archive.CreateEntry($e.Name)
      $stream = $entry.Open()
      try { $stream.Write($e.Bytes, 0, $e.Bytes.Length) } finally { $stream.Dispose() }
    }
  }
  finally { $archive.Dispose() }
}

function New-PortableCompanionZip {
  # A genuine, hashed, extractable portable payload standing in for the companion.
  # Carries a real *.exe entry addressed by the manifest 'entrypoint'.
  param([string]$Destination, [string]$Version)
  $exeBytes = [byte[]](0..511 | ForEach-Object { $_ % 256 })
  $pluginBytes = [System.IO.File]::ReadAllBytes((Join-Path $RepoRoot 'hermes-plugin\business-shell\plugin.js'))
  New-ZipFromEntries -Destination $Destination -Entries @(
    @{ Name = 'hermes-business.exe'; Bytes = $exeBytes },
    @{ Name = 'version.txt'; Bytes = [System.Text.Encoding]::ASCII.GetBytes($Version) },
    @{ Name = 'plugin.js'; Bytes = $pluginBytes }
  )
}

function New-ZipSlipCompanionZip {
  # Hostile archive: a legit entrypoint plus a zip-slip entry whose relative path
  # climbs out of the install root and resembles a Hermes user-state file. A safe
  # extractor MUST reject the whole archive and write nothing (in or out of root).
  param([string]$Destination)
  $exeBytes = [byte[]](0..255 | ForEach-Object { $_ % 256 })
  New-ZipFromEntries -Destination $Destination -Entries @(
    @{ Name = 'hermes-business.exe'; Bytes = $exeBytes },
    @{ Name = '../../../../hermes-home/sessions/state.db'; Bytes = [System.Text.Encoding]::ASCII.GetBytes('ZIP-SLIP-OVERWRITE-ATTEMPT') }
  )
}

function New-DecoyEntrypointZip {
  # A valid archive with the small declared entrypoint AND a LARGER alternate exe
  # elsewhere. Proves the deterministic entrypoint is honored and the bigger exe
  # is NOT selected (the old "largest recursive exe wins" behaviour).
  param([string]$Destination)
  $entrypointBytes = [byte[]](0..255 | ForEach-Object { $_ % 256 })          # 256 bytes
  $decoyBytes = [byte[]](0..8191 | ForEach-Object { $_ % 256 })              # 8192 bytes (larger)
  New-ZipFromEntries -Destination $Destination -Entries @(
    @{ Name = 'hermes-business.exe'; Bytes = $entrypointBytes },
    @{ Name = 'tools/updater-bigger.exe'; Bytes = $decoyBytes }
  )
}

function Invoke-ExpectFailClosed {
  # Runs an install that MUST fail closed: asserts it threw, the message matches
  # $Pattern, and that no entrypoint exe was promoted into $InstallRoot. Returns
  # the error message so callers can record it.
  param([string]$ManifestUrl, [string]$InstallRoot, [string]$Pattern, [string]$Entrypoint = 'hermes-business.exe', [switch]$AllowInsecureUrl)
  $threw = $false; $msg = ''
  try { Install-BusinessCompanion -ManifestUrl $ManifestUrl -InstallRoot $InstallRoot -AllowInsecureUrl:$AllowInsecureUrl | Out-Null }
  catch { $threw = $true; $msg = $_.Exception.Message }
  Assert-True $threw "expected a fail-closed error but none was raised for $ManifestUrl"
  Assert-True ($msg -match $Pattern) "unexpected error (want /$Pattern/): $msg"
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $InstallRoot $Entrypoint))) "a failed install still produced an executable in $InstallRoot"
  return $msg
}

function Start-StaticServer {
  # Launches the repo-native loopback static file server and waits until it serves.
  param([int]$Port, [string]$Root, [string]$StopFile, [string]$BaseUrl)
  if (Test-Path -LiteralPath $StopFile) { Remove-Item -LiteralPath $StopFile -Force }
  $serverScript = Join-Path $PSScriptRoot 'static-file-server.ps1'
  $powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $process = Start-Process -FilePath $powershell -PassThru -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $serverScript),
    '-Port', $Port, '-Root', ('"{0}"' -f $Root), '-StopFile', ('"{0}"' -f $StopFile)
  )
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try { Invoke-WebRequest -Uri "$BaseUrl/manifest.json" -UseBasicParsing | Out-Null; return $process }
    catch {
      if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode) { return $process }  # bound & answering
      if ($attempt -eq 59) { throw }
      Start-Sleep -Milliseconds 150
    }
  }
  return $process
}

function Stop-StaticServer {
  param($Process, [string]$StopFile)
  Set-Content -LiteralPath $StopFile -Value 'stop'
  if ($Process) {
    if (-not $Process.WaitForExit(3000)) {
      try { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
}
