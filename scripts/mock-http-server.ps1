[CmdletBinding()]
param(
  [Parameter(Mandatory)][int]$Port,
  [Parameter(Mandatory)][string]$StopFile,
  [ValidateSet('ok', 'flaky', 'oversize', 'ratelimit', 'forbidden', 'retryafter', 'junkheaders')][string]$Mode = 'ok',
  [string]$BodyPath,
  [int]$FailCount = 0,
  [long]$OversizeBytes = 262144,
  [int]$RetryAfterSeconds = 2,
  [int]$ResetInSeconds = 1800
)

# mock-http-server.ps1 — minimal, controllable loopback HTTP/1.1 server used by
# the bootstrap tests. It answers GET requests with a fixed body and can inject
# a run of HTTP 500s ('flaky' mode) to exercise retry/backoff. Loopback only;
# no admin/URL reservation required. Stops when $StopFile appears.
#
# The 403/429 modes reproduce GitHub's REST rate-limit shapes VERBATIM, because
# the three cases the retry classifier must tell apart differ ONLY by response
# header - a hand-built fake WebException would not prove the real
# HttpWebResponse header path works:
#   ratelimit   403 + X-RateLimit-Remaining: 0 + X-RateLimit-Reset (primary
#               limit; unauthenticated GitHub uses 403 here, NOT 429)
#   forbidden   bare 403, no rate-limit headers (genuine authorization refusal)
#   retryafter  429 + Retry-After for the first $FailCount requests, then 200
#               (secondary/abuse limit, which tells us how long to wait)
#   junkheaders 403 with unparseable rate-limit headers (must degrade, not throw)

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
        $extraHeaders = ''
        if ($Mode -eq 'flaky' -and $count -le $FailCount) {
          $status = '500 Internal Server Error'
          $payload = [System.Text.Encoding]::ASCII.GetBytes('transient')
        }
        elseif ($Mode -eq 'ratelimit') {
          # Primary limit: the budget for this window is spent. Reset is epoch
          # SECONDS, computed per request so the test never depends on wall time.
          $status = '403 rate limit exceeded'
          $payload = [System.Text.Encoding]::ASCII.GetBytes('{"message":"API rate limit exceeded"}')
          $resetEpoch = [long]([datetime]::UtcNow.AddSeconds($ResetInSeconds) - (New-Object System.DateTime 1970, 1, 1, 0, 0, 0, ([System.DateTimeKind]::Utc))).TotalSeconds
          $extraHeaders = "X-RateLimit-Limit: 60`r`nX-RateLimit-Remaining: 0`r`nX-RateLimit-Reset: $resetEpoch`r`n"
        }
        elseif ($Mode -eq 'forbidden') {
          $status = '403 Forbidden'
          $payload = [System.Text.Encoding]::ASCII.GetBytes('{"message":"Forbidden"}')
        }
        elseif ($Mode -eq 'junkheaders') {
          # Header values that exist but parse to nothing. The classifier must
          # treat these as "no rate-limit evidence", never crash on them.
          $status = '403 Forbidden'
          $payload = [System.Text.Encoding]::ASCII.GetBytes('{"message":"Forbidden"}')
          $extraHeaders = "X-RateLimit-Remaining: plenty`r`nX-RateLimit-Reset: tomorrow`r`nRetry-After: soon`r`n"
        }
        elseif ($Mode -eq 'retryafter' -and $count -le $FailCount) {
          # Secondary/abuse limit: retryable, and the server states the wait.
          $status = '429 Too Many Requests'
          $payload = [System.Text.Encoding]::ASCII.GetBytes('{"message":"You have exceeded a secondary rate limit"}')
          $extraHeaders = "Retry-After: $RetryAfterSeconds`r`n"
        }
        $header = "HTTP/1.1 $status`r`n$extraHeaders" + "Content-Length: $($payload.Length)`r`nConnection: close`r`nContent-Type: application/octet-stream`r`n`r`n"
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
