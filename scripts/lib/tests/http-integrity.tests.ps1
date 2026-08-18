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
    $expected = Get-Sha256Hash -Path $bodyPath
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

  # --- 500 keeps EXPONENTIAL backoff (regression guard for the rate-limit work).
  Test-Case 'HTTP 500 still backs off exponentially, not on a server directive' {
    $port = Get-FreeLoopbackPort
    $stop = Join-Path $WorkRoot "stop-backoff-$port"
    $bodyPath = Join-Path $WorkRoot 'backoff.json'
    Set-Content -LiteralPath $bodyPath -Value '{"ok":true,"value":7}' -Encoding ascii
    # Two 500s => the classifier must produce no server directive, so the caller
    # falls back to its own 500ms + 1000ms exponential schedule (~1.5s total).
    $server = Start-MockServer -Port $port -StopFile $stop -Mode 'flaky' -BodyPath $bodyPath -FailCount 2
    try {
      $watch = [System.Diagnostics.Stopwatch]::StartNew()
      $result = Invoke-HttpJson -Uri "http://127.0.0.1:$port/api" -MaxAttempts 6 -TimeoutSec 5 -Description 'backoff test endpoint'
      $watch.Stop()
      Assert-True ($result.value -eq 7) 'did not receive the eventual 200 body'
      Assert-True ($watch.Elapsed.TotalMilliseconds -ge 1200) "500 retries did not back off exponentially (only $([int]$watch.Elapsed.TotalMilliseconds) ms)"
      Assert-True ($watch.Elapsed.TotalMilliseconds -lt 15000) "500 retries took far too long ($([int]$watch.Elapsed.TotalMilliseconds) ms)"
    }
    finally {
      Stop-MockServer -Process $server -StopFile $stop
    }
  }

  # --- Case 2: PRIMARY rate limit (403 + X-RateLimit-Remaining: 0). ---------
  # GitHub answers an exhausted unauthenticated quota with 403, NOT 429, and the
  # window can be an hour wide - so this must fail FAST with copy that names the
  # rate limit and when it lifts, never burn the attempt budget.
  Test-Case 'primary rate limit (403 + X-RateLimit-Remaining: 0) fails fast and names the reset time' {
    $port = Get-FreeLoopbackPort
    $stop = Join-Path $WorkRoot "stop-ratelimit-$port"
    $server = Start-MockServer -Port $port -StopFile $stop -Mode 'ratelimit' -BodyPath ''
    try {
      $threw = $false
      $watch = [System.Diagnostics.Stopwatch]::StartNew()
      try {
        Invoke-HttpJson -Uri "http://127.0.0.1:$port/releases" -MaxAttempts 4 -TimeoutSec 5 -Description 'release list' | Out-Null
      }
      catch {
        $threw = $true
        $message = $_.Exception.Message
        Assert-True ($message -match 'after 1 attempt\(s\)') "the primary rate limit burned retries: $message"
        Assert-True ($message -match '(?i)rate limit') "the message never names the rate limit: $message"
        Assert-True ($message -match '\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}') "the message never states the local reset time: $message"
        Assert-True ($message -match '(?i)wait|try again') "the message gives the operator nothing to do: $message"
      }
      $watch.Stop()
      Assert-True $threw 'an exhausted rate limit did not fail'
      Assert-True ($watch.Elapsed.TotalMilliseconds -lt 5000) "the rate limit did not fail fast ($([int]$watch.Elapsed.TotalMilliseconds) ms)"
    }
    finally {
      Stop-MockServer -Process $server -StopFile $stop
    }
  }

  # --- Case 1: a bare 403 is a real refusal, not a rate limit. --------------
  Test-Case 'bare 403 Forbidden is not retried and is not mislabelled a rate limit' {
    $port = Get-FreeLoopbackPort
    $stop = Join-Path $WorkRoot "stop-forbidden-$port"
    $server = Start-MockServer -Port $port -StopFile $stop -Mode 'forbidden' -BodyPath ''
    try {
      $threw = $false
      try {
        Invoke-HttpJson -Uri "http://127.0.0.1:$port/releases" -MaxAttempts 4 -TimeoutSec 5 -Description 'release list' | Out-Null
      }
      catch {
        $threw = $true
        $message = $_.Exception.Message
        Assert-True ($message -match 'after 1 attempt\(s\)') "a genuine 403 was retried: $message"
        Assert-True ($message -match '403') "the 403 message lost the status code: $message"
        Assert-True (-not ($message -match '(?i)rate limit for this network|rate limit resets')) "a genuine 403 was mislabelled a rate limit: $message"
      }
      Assert-True $threw 'a 403 Forbidden did not fail'
    }
    finally {
      Stop-MockServer -Process $server -StopFile $stop
    }
  }

  # --- Case 3: secondary limit WITH Retry-After is retryable, on ITS clock. --
  Test-Case '429 with Retry-After is retried and the wait honours the header' {
    $port = Get-FreeLoopbackPort
    $stop = Join-Path $WorkRoot "stop-retryafter-$port"
    $bodyPath = Join-Path $WorkRoot 'retryafter.json'
    Set-Content -LiteralPath $bodyPath -Value '{"ok":true,"value":42}' -Encoding ascii
    $server = Start-MockServer -Port $port -StopFile $stop -Mode 'retryafter' -BodyPath $bodyPath -FailCount 1 -RetryAfterSeconds 2
    try {
      $watch = [System.Diagnostics.Stopwatch]::StartNew()
      $result = Invoke-HttpJson -Uri "http://127.0.0.1:$port/releases" -MaxAttempts 3 -TimeoutSec 5 -Description 'release list'
      $watch.Stop()
      Assert-True ($result.value -eq 42) 'the retry after a secondary rate limit never succeeded'
      # The exponential schedule would have waited only ~500ms on attempt 1, so
      # anything past ~1.8s proves Retry-After (2s) drove the wait, not backoff.
      Assert-True ($watch.Elapsed.TotalMilliseconds -ge 1800) "Retry-After was ignored in favour of the shorter backoff ($([int]$watch.Elapsed.TotalMilliseconds) ms)"
      Assert-True ($watch.Elapsed.TotalMilliseconds -lt 12000) "Retry-After overshot its own directive ($([int]$watch.Elapsed.TotalMilliseconds) ms)"
    }
    finally {
      Stop-MockServer -Process $server -StopFile $stop
    }
  }

  # --- Case 3 -> case 2: an over-clamp directive must not stall the installer.
  Test-Case 'Retry-After beyond the clamp fails fast instead of sleeping' {
    $port = Get-FreeLoopbackPort
    $stop = Join-Path $WorkRoot "stop-longwait-$port"
    $server = Start-MockServer -Port $port -StopFile $stop -Mode 'retryafter' -BodyPath '' -FailCount 99 -RetryAfterSeconds 3600
    try {
      $threw = $false
      $watch = [System.Diagnostics.Stopwatch]::StartNew()
      try {
        Invoke-HttpJson -Uri "http://127.0.0.1:$port/releases" -MaxAttempts 4 -TimeoutSec 5 -Description 'release list' | Out-Null
      }
      catch {
        $threw = $true
        $message = $_.Exception.Message
        Assert-True ($message -match 'after 1 attempt\(s\)') "an over-clamp Retry-After burned retries: $message"
        Assert-True ($message -match '(?i)rate limit') "the over-clamp message never names the rate limit: $message"
        Assert-True ($message -match '3600') "the over-clamp message never states the wait it was given: $message"
      }
      $watch.Stop()
      Assert-True $threw 'an hour-long Retry-After did not fail'
      Assert-True ($watch.Elapsed.TotalMilliseconds -lt 10000) "the installer slept on an hour-long Retry-After ($([int]$watch.Elapsed.TotalMilliseconds) ms)"
    }
    finally {
      Stop-MockServer -Process $server -StopFile $stop
    }
  }

  # --- Unreadable / unparseable headers must DEGRADE, never crash. ----------
  Test-Case '403 with unparseable rate-limit headers degrades to the plain refusal' {
    $port = Get-FreeLoopbackPort
    $stop = Join-Path $WorkRoot "stop-junkhdr-$port"
    $server = Start-MockServer -Port $port -StopFile $stop -Mode 'junkheaders' -BodyPath ''
    try {
      $threw = $false
      try {
        Invoke-HttpJson -Uri "http://127.0.0.1:$port/releases" -MaxAttempts 4 -TimeoutSec 5 -Description 'release list' | Out-Null
      }
      catch {
        $threw = $true
        $message = $_.Exception.Message
        Assert-True ($message -match 'after 1 attempt\(s\)') "junk headers changed the retry decision: $message"
        Assert-True ($message -match '403') "junk headers lost the status code: $message"
        Assert-True (-not ($message -match '(?i)resets at|wait about')) "junk headers were treated as a real rate-limit directive: $message"
      }
      Assert-True $threw 'a 403 with junk headers did not fail'
    }
    finally {
      Stop-MockServer -Process $server -StopFile $stop
    }
  }

  Test-Case 'header reads survive an absent, empty or hostile response object' {
    Assert-True ($null -eq (Get-WebResponseHeader -Response $null -Name 'Retry-After')) 'a null response did not degrade to $null'
    Assert-True ($null -eq (Get-WebResponseHeader -Response ([pscustomobject]@{ Nothing = 1 }) -Name 'Retry-After')) 'a header-less response did not degrade to $null'
    # A response whose Headers property THROWS on access - the exact shape a
    # disposed/aborted HttpWebResponse can take inside the retry catch block.
    $hostile = New-Object psobject
    $hostile | Add-Member -MemberType ScriptProperty -Name Headers -Value { throw 'headers unavailable' }
    Assert-True ($null -eq (Get-WebResponseHeader -Response $hostile -Name 'Retry-After')) 'a throwing Headers property was not contained'
  }

  Test-Case 'Retry-After and reset parsing reject junk without throwing' {
    Assert-True ((Get-RetryAfterMilliseconds -Value '2') -eq 2000) 'delta-seconds Retry-After was not read'
    Assert-True ((Get-RetryAfterMilliseconds -Value ' 5 ') -eq 5000) 'a padded Retry-After was not read'
    Assert-True ((Get-RetryAfterMilliseconds -Value 'soon') -eq 0) 'unparseable Retry-After did not degrade to no-directive'
    Assert-True ((Get-RetryAfterMilliseconds -Value '') -eq 0) 'an empty Retry-After did not degrade to no-directive'
    Assert-True ((Get-RetryAfterMilliseconds -Value '-30') -eq 0) 'a negative Retry-After did not degrade to no-directive'
    # Past HTTP-date => no directive; a hostile huge value must clamp, not overflow.
    Assert-True ((Get-RetryAfterMilliseconds -Value 'Wed, 21 Oct 2015 07:28:00 GMT') -eq 0) 'a past HTTP-date was not treated as no-directive'
    Assert-True ((Get-RetryAfterMilliseconds -Value '99999999999') -eq 86400000) 'an absurd Retry-After did not clamp'
    Assert-True ($null -eq (Format-RateLimitReset -Value 'tomorrow')) 'a non-epoch reset was not rejected'
    Assert-True ($null -eq (Format-RateLimitReset -Value '')) 'an empty reset was not rejected'
    $future = [long]([datetime]::UtcNow.AddMinutes(30) - (New-Object System.DateTime 1970, 1, 1, 0, 0, 0, ([System.DateTimeKind]::Utc))).TotalSeconds
    Assert-True ((Format-RateLimitReset -Value ([string]$future)) -match '\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}') 'a valid epoch reset was not rendered as a local timestamp'
  }

  Test-Case 'an unclassifiable failure fails CLOSED (never retried forever)' {
    $record = $null
    try { throw 'a failure that is not a network failure at all' } catch { $record = $_ }
    $verdict = Get-HttpFailureVerdict -ErrorRecord $record
    Assert-True (-not $verdict.Retryable) 'a non-network failure was classified retryable'
    Assert-True ($verdict.DelayMs -eq 0) 'a non-network failure invented a server directive'
    Assert-True (-not (Test-RetryableFailure -ErrorRecord $record)) 'the boolean facade disagreed with the verdict'
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
