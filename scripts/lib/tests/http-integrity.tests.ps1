# http-integrity.tests.ps1 — HTTP retry / bounded-download / SHA-256 integrity
# cases for the installer library. Dot-sourced by scripts/test-bootstrap-lib.ps1;
# uses the shared Test-Case / Assert-True / Start-MockServer harness defined there.

function Invoke-HttpIntegrityTests {
  param([Parameter(Mandatory)][string]$WorkRoot)
  Write-Host 'HTTP + integrity:'

  # --- HTTP 500 retry succeeds. ---------------------------------------------
  Test-Case 'HTTP 500 retried with backoff, then succeeds' {
    $port = Get-FreeLoopbackPort
    $stop = Join-Path $WorkRoot "stop-flaky-$port"
    $bodyPath = Join-Path $WorkRoot 'flaky.json'
    Set-Content -LiteralPath $bodyPath -Value '{"ok":true,"value":42}' -Encoding ascii
    $server = Start-MockServer -Port $port -StopFile $stop -Mode 'flaky' -BodyPath $bodyPath -FailCount 2
    try {
      $result = Invoke-HttpJson -Uri "http://127.0.0.1:$port/api" -MaxAttempts 6 -TimeoutSec 5 -Description 'flaky test endpoint'
      Assert-True ($result.value -eq 42) 'did not receive the eventual 200 body'
    }
    finally {
      Stop-MockServer -Process $server -StopFile $stop
    }
  }

  # --- Truncated / hash mismatch rejected. ----------------------------------
  Test-Case 'download with wrong SHA-256 is rejected (truncated/tampered)' {
    $port = Get-FreeLoopbackPort
    $stop = Join-Path $WorkRoot "stop-trunc-$port"
    $bodyPath = Join-Path $WorkRoot 'served.bin'
    [System.IO.File]::WriteAllBytes($bodyPath, ([byte[]](1..2048 | ForEach-Object { $_ % 256 })))
    $server = Start-MockServer -Port $port -StopFile $stop -Mode 'ok' -BodyPath $bodyPath
    try {
      $wrongHash = ('a' * 64)
      $dest = Join-Path $WorkRoot 'download.bin'
      $threw = $false
      try {
        Save-HttpFile -Uri "http://127.0.0.1:$port/file.bin" -Destination $dest -ExpectedSha256 $wrongHash -MaxAttempts 3 -TimeoutSec 5 | Out-Null
      }
      catch {
        $threw = $true
        Assert-True ($_.Exception.Message -match 'mismatch|truncated|tampered') "unexpected error: $($_.Exception.Message)"
      }
      Assert-True $threw 'a mismatched hash did not raise an error'
      Assert-True (-not (Test-Path -LiteralPath $dest)) 'a failed download left a destination file behind'
    }
    finally {
      Stop-MockServer -Process $server -StopFile $stop
    }
  }

  # --- Correct SHA-256 accepted (positive control). -------------------------
  Test-Case 'download with correct SHA-256 succeeds and is atomic' {
    $port = Get-FreeLoopbackPort
    $stop = Join-Path $WorkRoot "stop-ok-$port"
    $bodyPath = Join-Path $WorkRoot 'served-ok.bin'
    [System.IO.File]::WriteAllBytes($bodyPath, ([byte[]](1..4096 | ForEach-Object { ($_ * 7) % 256 })))
    $expected = (Get-FileHash -Algorithm SHA256 -LiteralPath $bodyPath).Hash
    $server = Start-MockServer -Port $port -StopFile $stop -Mode 'ok' -BodyPath $bodyPath
    try {
      $dest = Join-Path $WorkRoot 'download-ok.bin'
      Save-HttpFile -Uri "http://127.0.0.1:$port/file.bin" -Destination $dest -ExpectedSha256 $expected -MaxAttempts 4 -TimeoutSec 5 | Out-Null
      Assert-True (Test-Path -LiteralPath $dest) 'verified download was not written'
      Assert-True (-not (Test-Path -LiteralPath "$dest.$PID.part")) 'a .part temp file leaked'
    }
    finally {
      Stop-MockServer -Process $server -StopFile $stop
    }
  }

  # --- MaxBytes enforced DURING streaming; partial .part is cleaned up. ------
  Test-Case 'over-ceiling body is rejected mid-stream and leaves no partial file' {
    $port = Get-FreeLoopbackPort
    $stop = Join-Path $WorkRoot "stop-oversize-$port"
    # 'oversize' mode streams 256 KiB with NO Content-Length, so only the
    # streaming byte counter (not the header check) can catch the 4 KiB ceiling.
    $server = Start-MockServer -Port $port -StopFile $stop -Mode 'oversize' -BodyPath ''
    try {
      $dest = Join-Path $WorkRoot 'oversize.bin'
      $threw = $false
      try {
        Save-HttpFile -Uri "http://127.0.0.1:$port/big.bin" -Destination $dest -MaxBytes 4096 -MaxAttempts 2 -TimeoutSec 5 | Out-Null
      }
      catch {
        $threw = $true
        Assert-True ($_.Exception.Message -match 'ceiling|MAXBYTES') "unexpected over-ceiling error: $($_.Exception.Message)"
      }
      Assert-True $threw 'an over-ceiling stream was not rejected'
      Assert-True (-not (Test-Path -LiteralPath $dest)) 'an over-ceiling download left the destination behind'
      Assert-True (-not (Test-Path -LiteralPath "$dest.$PID.part")) 'an over-ceiling download leaked a .part file'
    }
    finally {
      Stop-MockServer -Process $server -StopFile $stop
    }
  }

  # --- Offline: connection refused fails closed with guidance. --------------
  Test-Case 'offline (connection refused) fails closed with guided copy' {
    $deadPort = Get-FreeLoopbackPort  # nothing is listening on it
    $threw = $false
    try {
      Invoke-HttpJson -Uri "http://127.0.0.1:$deadPort/api" -MaxAttempts 2 -TimeoutSec 3 -Description 'offline endpoint' | Out-Null
    }
    catch {
      $threw = $true
      Assert-True ($_.Exception.Message -match 'offline|connection|refused|reach|proxy|firewall') "offline error lacked guidance: $($_.Exception.Message)"
    }
    Assert-True $threw 'a request to a dead port did not fail'
  }
}
