# HttpRetry.ps1 — TLS policy, transient-failure classification, bounded retry and
# JSON requests. This is the request/retry half of the network layer; the bounded
# file download half lives in HttpDownload.ps1. Everything that opens a socket for
# the bootstrap flows through here so retry, timeout, backoff, TLS policy and the
# human-readable offline/proxy/TLS guidance stay consistent.
#
# Depends on: Logging.ps1 (Write-Step).

# Status codes that justify a retry: transient server / rate-limit / timeout.
$script:RetryableHttpStatus = @(408, 425, 429, 500, 502, 503, 504)

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

function Test-RetryableFailure {
  [CmdletBinding()]
  param([Parameter(Mandatory)][System.Management.Automation.ErrorRecord]$ErrorRecord)

  $exception = $ErrorRecord.Exception
  $webException = $exception
  while ($webException -and -not ($webException -is [System.Net.WebException])) {
    $webException = $webException.InnerException
  }
  if ($webException -is [System.Net.WebException]) {
    if ($webException.Status -in @('Timeout', 'ConnectFailure', 'ReceiveFailure', 'SendFailure', 'KeepAliveFailure')) {
      return $true
    }
    $response = $webException.Response -as [System.Net.HttpWebResponse]
    if ($response -and ([int]$response.StatusCode) -in $script:RetryableHttpStatus) {
      return $true
    }
  }
  return $false
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
      $retryable = Test-RetryableFailure -ErrorRecord $_
      if ($attempt -ge $MaxAttempts -or -not $retryable) {
        $hint = Get-NetworkErrorHint -ErrorRecord $_
        $detail = $_.Exception.Message
        $suffix = ''
        if ($hint) { $suffix = " $hint" }
        throw "Failed to complete the $Description after $attempt attempt(s): $detail$suffix"
      }
      $delay = [Math]::Min($MaxDelayMs, [int]($BaseDelayMs * [Math]::Pow(2, $attempt - 1)))
      Write-Step "Transient failure on the $Description (attempt $attempt/$MaxAttempts): $($_.Exception.Message). Retrying in $delay ms."
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
