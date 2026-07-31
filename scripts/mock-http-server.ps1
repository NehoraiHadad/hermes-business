[CmdletBinding()]
param(
  [Parameter(Mandatory)][int]$Port,
  [Parameter(Mandatory)][string]$StopFile,
  [ValidateSet('ok', 'flaky', 'oversize')][string]$Mode = 'ok',
  [string]$BodyPath,
  [int]$FailCount = 0,
  [long]$OversizeBytes = 262144
)

# mock-http-server.ps1 — minimal, controllable loopback HTTP/1.1 server used by
# the bootstrap tests. It answers GET requests with a fixed body and can inject
# a run of HTTP 500s ('flaky' mode) to exercise retry/backoff. Loopback only;
# no admin/URL reservation required. Stops when $StopFile appears.

$ErrorActionPreference = 'Stop'
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
$body = if ($BodyPath -and (Test-Path -LiteralPath $BodyPath)) { [System.IO.File]::ReadAllBytes($BodyPath) } else { [byte[]]@() }
$count = 0
try {
  while (-not (Test-Path -LiteralPath $StopFile)) {
    if (-not $listener.Pending()) { Start-Sleep -Milliseconds 30; continue }
    $client = $listener.AcceptTcpClient()
    $count++
    try {
      $client.ReceiveTimeout = 2000
      $stream = $client.GetStream()
      $buffer = New-Object byte[] 4096
      try { $stream.Read($buffer, 0, $buffer.Length) | Out-Null } catch {}
      if ($Mode -eq 'oversize') {
        # Stream far more than any ceiling WITHOUT a Content-Length, so the
        # download's early header check can't catch it — only its mid-stream
        # byte counter can. Proves MaxBytes is enforced during streaming.
        $header = "HTTP/1.1 200 OK`r`nConnection: close`r`nContent-Type: application/octet-stream`r`n`r`n"
        $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
        $stream.Write($headerBytes, 0, $headerBytes.Length)
        $chunk = New-Object byte[] 65536
        $sent = 0L
        while ($sent -lt $OversizeBytes) {
          $stream.Write($chunk, 0, $chunk.Length)
          $sent += $chunk.Length
        }
        $stream.Flush()
      }
      else {
        $status = '200 OK'
        $payload = $body
        if ($Mode -eq 'flaky' -and $count -le $FailCount) {
          $status = '500 Internal Server Error'
          $payload = [System.Text.Encoding]::ASCII.GetBytes('transient')
        }
        $header = "HTTP/1.1 $status`r`nContent-Length: $($payload.Length)`r`nConnection: close`r`nContent-Type: application/octet-stream`r`n`r`n"
        $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
        $stream.Write($headerBytes, 0, $headerBytes.Length)
        if ($payload.Length -gt 0) { $stream.Write($payload, 0, $payload.Length) }
        $stream.Flush()
      }
    }
    catch {
      # A broken/abandoned client must never take the server down.
    }
    finally {
      $client.Close()
    }
  }
}
finally {
  $listener.Stop()
}
