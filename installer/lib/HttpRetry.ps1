# HttpRetry.ps1 — TLS policy, transient-failure classification, bounded retry and
# JSON requests. This is the request/retry half of the network layer; the bounded
# file download half lives in HttpDownload.ps1. Everything that opens a socket for
# the bootstrap flows through here so retry, timeout, backoff, TLS policy and the
# human-readable offline/proxy/TLS guidance stay consistent.
#
# Depends on: Logging.ps1 (Write-Step).

# Status codes that justify a retry: transient server / rate-limit / timeout.
# 403 is deliberately ABSENT: a bare 403 is a genuine authorization refusal and
# hammering it in a loop cannot turn into a 200. GitHub, however, reports its
# PRIMARY rate limit as 403 (not 429) and its secondary/abuse limit as 403 OR
# 429, so rate limits are identified from the RESPONSE HEADERS (see
# Get-HttpFailureVerdict), never from the status code alone.
$script:RetryableHttpStatus = @(408, 425, 429, 500, 502, 503, 504)

# Statuses that MAY carry GitHub rate-limit semantics and therefore need the
# header inspection above before the status list gets the final word.
$script:RateLimitHttpStatus = @(403, 429)

# Longest server-directed wait (Retry-After) we are willing to sit on. An
# installer that silently sleeps for minutes looks hung to the operator, so a
# longer directive becomes an honest "come back later" failure instead of a
# hidden stall. Kept generous enough that a normal secondary-limit backoff hint
# is still absorbed automatically.
$script:MaxRetryAfterMs = 30000

# Absurd Retry-After values are clamped before the seconds -> milliseconds
# multiply, so a hostile header can never overflow the arithmetic.
$script:MaxRetryAfterParseSeconds = 86400

function Enable-ModernTls {
  # Windows PowerShell 5.1 may still default to TLS 1.0/1.1, which GitHub and
  # most CDNs now reject. Opt into TLS 1.2 (+1.3 when the runtime supports it).
  [CmdletBinding()]
  param()
  try {
    $protocols = [System.Net.SecurityProtocolType]::Tls12
    if ([enum]::IsDefined([System.Net.SecurityProtocolType], 'Tls13')) {
      $protocols = $protocols -bor [System.Net.SecurityProtocolType]::Tls13
    }
    [System.Net.ServicePointManager]::SecurityProtocol = `
      [System.Net.ServicePointManager]::SecurityProtocol -bor $protocols
  }
  catch {
    Write-Step "Unable to raise the TLS protocol floor: $($_.Exception.Message)"
  }
}

function Get-NetworkErrorHint {
  # Translates a raw transport failure into copy a non-technical operator can
  # act on: offline, proxy interception, or an out-of-date TLS/root-store.
  [CmdletBinding()]
  param([Parameter(Mandatory)][System.Management.Automation.ErrorRecord]$ErrorRecord)

  $exception = $ErrorRecord.Exception
  $message = [string]$exception.Message
  $webException = $exception
  while ($webException -and -not ($webException -is [System.Net.WebException])) {
    $webException = $webException.InnerException
  }

  if ($webException -is [System.Net.WebException]) {
    switch ($webException.Status) {
      'NameResolutionFailure' {
        return 'The server name could not be resolved. Check the internet connection or DNS. If this machine uses a corporate proxy, configure it before retrying.'
      }
      'ConnectFailure' {
        return 'Could not open a connection to the server. The machine may be offline or a firewall/proxy is blocking outbound HTTPS (port 443).'
      }
      'Timeout' {
        return 'The request timed out. A slow link or an intercepting proxy can cause this; retry on a faster or unfiltered connection.'
      }
      'TrustFailure' {
        return 'The server certificate could not be trusted. A TLS-inspecting proxy or a missing/expired root certificate is the usual cause. Import the proxy root certificate or use a direct connection.'
      }
      'SecureChannelFailure' {
        return 'The secure (TLS) channel could not be established. The system may be missing TLS 1.2 support or a proxy is downgrading the connection.'
      }
    }
  }

  if ($message -match '(?i)proxy') {
    return 'A proxy error occurred. Verify the proxy settings (netsh winhttp / system proxy) or use a direct connection.'
  }
  if ($message -match '(?i)could not be resolved|no such host|actively refused|unable to connect') {
    return 'The machine appears to be offline or blocked from reaching the server. Confirm connectivity and retry.'
  }
  return $null
}

function Get-WebResponseHeader {
  # DEFENSIVE header read. On a failed request the response may be absent, may
  # not be an HttpWebResponse at all, may already have been disposed, or may
  # simply throw on property access. Every one of those must degrade to $null so
  # classification falls back to status-only behaviour: a crash here would fire
  # INSIDE the retry catch block and replace an honest network error with a
  # confusing one.
  [CmdletBinding()]
  param([object]$Response, [Parameter(Mandatory)][string]$Name)
  try {
    if ($null -eq $Response) { return $null }
    $headers = $Response.Headers
    if ($null -eq $headers) { return $null }
    $value = $headers[$Name]
    if ([string]::IsNullOrWhiteSpace([string]$value)) { return $null }
    return ([string]$value).Trim()
  }
  catch {
    return $null
  }
}

function Get-RetryAfterMilliseconds {
  # RFC 7231 Retry-After is either delta-seconds ("120") or an HTTP-date
  # ("Wed, 21 Oct 2015 07:28:00 GMT"). Returns 0 for an absent, unparseable or
  # already-past value, which the caller reads as "no server directive, use my
  # own exponential backoff" - never as "retry immediately".
  [CmdletBinding()]
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return [long]0 }
  $text = ([string]$Value).Trim()

  $seconds = [long]0
  if ([long]::TryParse($text, [ref]$seconds)) {
    if ($seconds -le 0) { return [long]0 }
    if ($seconds -gt $script:MaxRetryAfterParseSeconds) { $seconds = [long]$script:MaxRetryAfterParseSeconds }
    return [long]($seconds * 1000)
  }

  # HTTP-date form, parsed culture-INVARIANTLY: the header is always English
  # GMT, but the installer runs under whatever locale the machine happens to be.
  $when = [datetimeoffset]::MinValue
  try {
    $parsed = [datetimeoffset]::TryParse(
      $text,
      [System.Globalization.CultureInfo]::InvariantCulture,
      [System.Globalization.DateTimeStyles]::AssumeUniversal,
      [ref]$when)
    if ($parsed) {
      $deltaMs = ($when - [datetimeoffset]::UtcNow).TotalMilliseconds
      if ($deltaMs -le 0) { return [long]0 }
      $capMs = [double]($script:MaxRetryAfterParseSeconds * 1000)
      if ($deltaMs -gt $capMs) { $deltaMs = $capMs }
      return [long]$deltaMs
    }
  }
  catch {
    # An unparseable date is not a reason to blow up; fall through to "no directive".
  }
  return [long]0
}

function Format-RateLimitReset {
  # X-RateLimit-Reset is epoch SECONDS. Rendered in LOCAL time plus a relative
  # "in about N minutes", because "resets at 1755530000" tells an operator
  # nothing. Returns $null when the header is missing or is not a sane epoch, so
  # the caller can still name the rate limit without inventing a time.
  [CmdletBinding()]
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
  $epoch = [long]0
  if (-not [long]::TryParse(([string]$Value).Trim(), [ref]$epoch)) { return $null }
  if ($epoch -le 0) { return $null }
  try {
    $unixStart = New-Object System.DateTime 1970, 1, 1, 0, 0, 0, ([System.DateTimeKind]::Utc)
    $resetLocal = $unixStart.AddSeconds([double]$epoch).ToLocalTime()
    $minutes = [int][Math]::Ceiling(($resetLocal - (Get-Date)).TotalMinutes)
    $stamp = $resetLocal.ToString('yyyy-MM-dd HH:mm:ss')
    if ($minutes -gt 0) { return "$stamp (in about $minutes minute(s))" }
    return $stamp
  }
  catch {
    # Out-of-range epoch (garbage header). Better to say nothing than to lie.
    return $null
  }
}

function Get-HttpFailureVerdict {
  # THE single classification point for a failed request. The three 403/429
  # cases are kept DISTINCT because they need opposite handling:
  #
  #   1. Bare 403 Forbidden (no rate-limit headers) - NOT retryable. A genuine
  #      authorization refusal; looping on it can never become a 200. Only the
  #      operator-facing copy improves.
  #   2. PRIMARY rate limit (403 or 429 with X-RateLimit-Remaining: 0) - NOT
  #      retryable, and we fail FAST. The window can be up to an hour wide, so
  #      no bounded retry can succeed; burning the attempt budget only delays an
  #      inevitable failure. Instead we name the limit and its reset time.
  #   3. Secondary / abuse limit carrying Retry-After - IS retryable, and the
  #      server told us exactly how long to wait, so we honour that instead of
  #      our own backoff. If the directive exceeds $script:MaxRetryAfterMs it
  #      collapses into case 2: fail fast rather than stall the installer.
  #
  # Returns a verdict object:
  #   Retryable [bool]   - may another attempt plausibly succeed?
  #   DelayMs   [long]   - server-directed wait; 0 => caller uses its own backoff
  #   Message   [string] - actionable operator copy, or $null
  #
  # Fails CLOSED: anything it cannot positively classify comes back
  # Retryable=$false, so an unknown failure surfaces instead of looping.
  [CmdletBinding()]
  param([Parameter(Mandatory)][System.Management.Automation.ErrorRecord]$ErrorRecord)

  $verdict = [pscustomobject]@{ Retryable = $false; DelayMs = [long]0; Message = $null }

  $webException = $ErrorRecord.Exception
  while ($webException -and -not ($webException -is [System.Net.WebException])) {
    $webException = $webException.InnerException
  }
  if (-not ($webException -is [System.Net.WebException])) { return $verdict }

  # Transport-level trouble is retryable regardless of any response object.
  if ($webException.Status -in @('Timeout', 'ConnectFailure', 'ReceiveFailure', 'SendFailure', 'KeepAliveFailure')) {
    $verdict.Retryable = $true
    return $verdict
  }

  $response = $webException.Response -as [System.Net.HttpWebResponse]
  if (-not $response) { return $verdict }
  $status = 0
  try { $status = [int]$response.StatusCode }
  catch { return $verdict }

  if ($status -in $script:RateLimitHttpStatus) {
    $remaining = Get-WebResponseHeader -Response $response -Name 'X-RateLimit-Remaining'
    $retryAfterMs = Get-RetryAfterMilliseconds -Value (Get-WebResponseHeader -Response $response -Name 'Retry-After')

    # Case 3 is tested FIRST: an explicit Retry-After is the server stating
    # precisely when it will serve us again, which beats inferring from the
    # reset window even when both headers are present.
    if ($retryAfterMs -gt 0) {
      if ($retryAfterMs -le $script:MaxRetryAfterMs) {
        $verdict.Retryable = $true
        $verdict.DelayMs = $retryAfterMs
        return $verdict
      }
      $waitSeconds = [int][Math]::Ceiling($retryAfterMs / 1000)
      $verdict.Message = "The download server is rate limiting this network and asked us to wait about $waitSeconds second(s) before trying again - longer than the installer will wait. Try again after that, or from a different internet connection."
      return $verdict
    }

    # Case 2: the primary limit for this window is used up.
    $remainingCount = 0
    if ($null -ne $remaining -and [int]::TryParse($remaining, [ref]$remainingCount) -and $remainingCount -le 0) {
      $reset = Format-RateLimitReset -Value (Get-WebResponseHeader -Response $response -Name 'X-RateLimit-Reset')
      $when = 'a short while'
      if ($reset) { $when = $reset }
      $verdict.Message = "The download server's API rate limit for this network has been used up, so it refused the request (HTTP $status). The rate limit resets at $when - wait until then and run this again, or try from a different internet connection."
      return $verdict
    }

    # Case 1: a bare 403 with no rate-limit evidence. Stays NOT retryable - the
    # only change is copy that stops the operator hunting for a network fault.
    if ($status -eq 403) {
      $verdict.Message = 'The server refused the request (HTTP 403 Forbidden) and reported no rate limit, so retrying would not help. Check that this machine is allowed to reach the download server - a corporate proxy or content filter is the usual cause.'
      return $verdict
    }
    # A bare 429 carries nothing to act on but is transient by definition, so it
    # falls through to the status list below and keeps the exponential backoff.
  }

  if ($status -in $script:RetryableHttpStatus) { $verdict.Retryable = $true }
  return $verdict
}

function Test-RetryableFailure {
  # Thin boolean facade over Get-HttpFailureVerdict, kept because yes/no is the
  # published shape of this classification and reads clearly at call sites that
  # need nothing else.
  [CmdletBinding()]
  param([Parameter(Mandatory)][System.Management.Automation.ErrorRecord]$ErrorRecord)
  return [bool](Get-HttpFailureVerdict -ErrorRecord $ErrorRecord).Retryable
}

function Invoke-WithHttpRetry {
  # Runs a network scriptblock with bounded exponential backoff. The scriptblock
  # must perform exactly one request and return its result (or throw).
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][scriptblock]$Action,
    [string]$Description = 'network request',
    [int]$MaxAttempts = 4,
    [int]$BaseDelayMs = 500,
    [int]$MaxDelayMs = 8000
  )
  Enable-ModernTls
  $attempt = 0
  while ($true) {
    $attempt++
    try {
      return & $Action
    }
    catch {
      $verdict = Get-HttpFailureVerdict -ErrorRecord $_
      if ($attempt -ge $MaxAttempts -or -not $verdict.Retryable) {
        $hint = Get-NetworkErrorHint -ErrorRecord $_
        $detail = $_.Exception.Message
        $suffix = ''
        # A positively identified rate limit / refusal is far more actionable
        # than the generic transport hint, so it wins when both are available.
        if ($verdict.Message) { $suffix = " $($verdict.Message)" }
        elseif ($hint) { $suffix = " $hint" }
        throw "Failed to complete the $Description after $attempt attempt(s): $detail$suffix"
      }
      if ($verdict.DelayMs -gt 0) {
        # Server-directed wait (Retry-After), already clamped by the classifier.
        $delay = [int]$verdict.DelayMs
        Write-Step "The server asked us to slow down on the $Description (attempt $attempt/$MaxAttempts): $($_.Exception.Message). Honouring Retry-After: waiting $delay ms."
      }
      else {
        $delay = [Math]::Min($MaxDelayMs, [int]($BaseDelayMs * [Math]::Pow(2, $attempt - 1)))
        Write-Step "Transient failure on the $Description (attempt $attempt/$MaxAttempts): $($_.Exception.Message). Retrying in $delay ms."
      }
      Start-Sleep -Milliseconds $delay
    }
  }
}

function Invoke-HttpJson {
  # Retry-wrapped Invoke-RestMethod for JSON/API endpoints.
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][uri]$Uri,
    [hashtable]$Headers,
    [string]$Method = 'Get',
    [int]$TimeoutSec = 30,
    [int]$MaxAttempts = 4,
    [string]$Description
  )
  if (-not $Description) { $Description = "request to $($Uri.Host)" }
  return Invoke-WithHttpRetry -Description $Description -MaxAttempts $MaxAttempts -Action {
    Invoke-RestMethod -Uri $Uri -Headers $Headers -Method $Method -TimeoutSec $TimeoutSec
  }
}
