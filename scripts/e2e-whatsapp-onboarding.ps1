[CmdletBinding()]
param(
  [string]$HermesHome = (Join-Path $env:LOCALAPPDATA 'hermes')
)

$ErrorActionPreference = 'Stop'
$HermesHome = [System.IO.Path]::GetFullPath($HermesHome)
$hermesExe = Join-Path $HermesHome 'hermes-agent\venv\Scripts\hermes.exe'
if (-not (Test-Path -LiteralPath $hermesExe -PathType Leaf)) {
  throw "Hermes executable not found at $hermesExe"
}

$listener = [System.Net.Sockets.TcpListener]::new(
  [System.Net.IPAddress]::Loopback,
  0
)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()

$token = [guid]::NewGuid().ToString('N')
$env:HERMES_HOME = $HermesHome
$env:HERMES_DASHBOARD_SESSION_TOKEN = $token
$stdoutPath = Join-Path $env:TEMP "hermes-wa-$PID.stdout.log"
$stderrPath = Join-Path $env:TEMP "hermes-wa-$PID.stderr.log"
$server = $null
$pairingId = $null

try {
  $server = Start-Process -FilePath $hermesExe `
    -ArgumentList @('serve', '--host', '127.0.0.1', '--port', "$port") `
    -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath
  $headers = @{ Authorization = "Bearer $token" }
  $health = $null
  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    try {
      $health = Invoke-RestMethod `
        -Uri "http://127.0.0.1:$port/api/health" `
        -Headers $headers -TimeoutSec 2
      break
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $health) {
    throw 'Temporary Hermes server did not become healthy.'
  }

  $body = @{
    mode = 'bot'
    allowed_users = ''
    profile = 'default'
  } | ConvertTo-Json
  $state = Invoke-RestMethod `
    -Uri "http://127.0.0.1:$port/api/messaging/whatsapp/onboarding/start" `
    -Method Post -Headers $headers -ContentType 'application/json' `
    -Body $body -TimeoutSec 30
  $pairingId = [string]$state.pairing_id
  $observed = @([string]$state.status)

  for ($attempt = 0; $attempt -lt 45; $attempt++) {
    if ($state.status -in @('waiting', 'connected', 'error', 'expired')) {
      break
    }
    Start-Sleep -Seconds 1
    $state = Invoke-RestMethod `
      -Uri "http://127.0.0.1:$port/api/messaging/whatsapp/onboarding/$pairingId" `
      -Headers $headers -TimeoutSec 5
    $observed += [string]$state.status
  }

  [PSCustomObject]@{
    health = [bool]$health.ok
    pairing_id_present = -not [string]::IsNullOrWhiteSpace($pairingId)
    final_status = [string]$state.status
    qr_payload_present = -not [string]::IsNullOrWhiteSpace(
      [string]$state.qr_payload
    )
    observed = $observed -join ' -> '
  } | ConvertTo-Json -Compress

  if ($state.status -notin @('waiting', 'connected')) {
    throw "WhatsApp onboarding did not reach a usable state: $($state.status)"
  }
} finally {
  if ($pairingId) {
    try {
      Invoke-RestMethod `
        -Uri "http://127.0.0.1:$port/api/messaging/whatsapp/onboarding/$pairingId" `
        -Method Delete -Headers $headers -TimeoutSec 10 | Out-Null
    } catch {}
  }
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force
    Wait-Process -Id $server.Id -Timeout 10 -ErrorAction SilentlyContinue
  }
  if ($server) { $server.Dispose() }
  foreach ($logPath in @($stdoutPath, $stderrPath)) {
    for ($attempt = 0; $attempt -lt 20 -and (Test-Path -LiteralPath $logPath); $attempt++) {
      try {
        Remove-Item -LiteralPath $logPath -Force -ErrorAction Stop
      } catch {
        Start-Sleep -Milliseconds 250
      }
    }
    if (Test-Path -LiteralPath $logPath) {
      Write-Warning "Temporary log remained locked: $logPath"
    }
  }
}
