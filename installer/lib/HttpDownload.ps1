# HttpDownload.ps1 — bounded, atomic, hash-verified file downloads. This is the
# download half of the network layer; TLS policy, retry classification and the
# retry wrapper it leans on live in HttpRetry.ps1. MaxBytes is enforced AS BYTES
# ARRIVE (streaming), so a hostile/runaway body is stopped before it is committed.
#
# Depends on: HttpRetry.ps1 (Invoke-WithHttpRetry, Enable-ModernTls),
#             Hashing.ps1 (Assert-Sha256Match), Logging.ps1 (Write-Step).

# Sentinel wrapped around a hard size-ceiling breach so the retry layer treats it
# as terminal (retrying an over-large body just re-downloads the same attack).
$script:MaxBytesMarker = 'HERMES_MAXBYTES_EXCEEDED'

function Invoke-BoundedDownload {
  # Streams the response to $PartPath in chunks, enforcing $MaxBytes AS BYTES
  # ARRIVE (not after a full disk write). Uses HttpWebRequest so the system proxy
  # (WebRequest.DefaultWebProxy) and TLS policy set by Enable-ModernTls both apply,
  # exactly like Invoke-WebRequest. Aborts and leaves cleanup to the caller.
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][uri]$Uri,
    [Parameter(Mandatory)][string]$PartPath,
    [hashtable]$Headers,
    [int]$TimeoutSec = 120,
    [long]$MaxBytes = 0
  )
  $request = [System.Net.HttpWebRequest]::Create($Uri)
  $request.Method = 'GET'
  $request.Timeout = $TimeoutSec * 1000
  $request.ReadWriteTimeout = $TimeoutSec * 1000
  $request.AllowAutoRedirect = $true
  if ($Headers) {
    foreach ($key in $Headers.Keys) {
      # User-Agent is a restricted header and must be set via the property.
      if ($key -ieq 'User-Agent') { $request.UserAgent = [string]$Headers[$key] }
      else { $request.Headers[[string]$key] = [string]$Headers[$key] }
    }
  }
  $response = $request.GetResponse()
  try {
    # Fast reject when the server honestly declares an over-ceiling length.
    if ($MaxBytes -gt 0 -and $response.ContentLength -gt $MaxBytes) {
      throw "$script:MaxBytesMarker the response declared $($response.ContentLength) bytes (over the $MaxBytes byte ceiling)."
    }
    $responseStream = $response.GetResponseStream()
    $fileStream = [System.IO.File]::Open($PartPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
      $buffer = New-Object byte[] 65536
      $total = 0L
      while (($read = $responseStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $total += $read
        if ($MaxBytes -gt 0 -and $total -gt $MaxBytes) {
          # Streaming ceiling breach: stop reading immediately, before the rest of
          # the hostile/runaway body can be committed to disk.
          throw "$script:MaxBytesMarker the response exceeded the $MaxBytes byte ceiling mid-stream."
        }
        $fileStream.Write($buffer, 0, $read)
      }
      $fileStream.Flush()
    }
    finally {
      $fileStream.Dispose()
      $responseStream.Dispose()
    }
  }
  finally {
    $response.Dispose()
  }
}

function Save-HttpFile {
  # Retry-wrapped download to a file, written atomically (.part then move) with
  # size bounds and SHA-256 verification. MaxBytes is enforced DURING streaming;
  # a truncated or tampered body fails the hash check; every failure discards the
  # partial .part file.
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][uri]$Uri,
    [Parameter(Mandatory)][string]$Destination,
    [hashtable]$Headers,
    [int]$TimeoutSec = 120,
    [int]$MaxAttempts = 4,
    [string]$ExpectedSha256,
    [long]$MinBytes = 0,
    [long]$MaxBytes = 0,
    [string]$Description
  )
  if (-not $Description) { $Description = "download from $($Uri.Host)" }
  $targetDir = Split-Path -Parent $Destination
  if ($targetDir) { New-Item -ItemType Directory -Force -Path $targetDir | Out-Null }
  $partPath = "$Destination.$PID.part"

  try {
    Invoke-WithHttpRetry -Description $Description -MaxAttempts $MaxAttempts -Action {
      if (Test-Path -LiteralPath $partPath) { Remove-Item -LiteralPath $partPath -Force }
      Invoke-BoundedDownload -Uri $Uri -PartPath $partPath -Headers $Headers -TimeoutSec $TimeoutSec -MaxBytes $MaxBytes
    } | Out-Null

    $info = Get-Item -LiteralPath $partPath
    if ($MinBytes -gt 0 -and $info.Length -lt $MinBytes) {
      throw "The $Description returned only $($info.Length) bytes (expected at least $MinBytes). It is likely truncated."
    }
    if ($MaxBytes -gt 0 -and $info.Length -gt $MaxBytes) {
      throw "The $Description returned $($info.Length) bytes (over the $MaxBytes byte ceiling). Refusing to trust it."
    }
    if ($ExpectedSha256) {
      Assert-Sha256Match -Path $partPath -Expected $ExpectedSha256 -What $Description | Out-Null
    }
    Move-Item -LiteralPath $partPath -Destination $Destination -Force
    return $Destination
  }
  finally {
    if (Test-Path -LiteralPath $partPath) {
      Remove-Item -LiteralPath $partPath -Force -ErrorAction SilentlyContinue
    }
  }
}
