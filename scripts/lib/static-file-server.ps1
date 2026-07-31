[CmdletBinding()]
param(
  [Parameter(Mandatory)][int]$Port,
  [Parameter(Mandatory)][string]$Root,
  [Parameter(Mandatory)][string]$StopFile
)

# static-file-server.ps1 — repo-native, loopback-only static HTTP/1.1 file server
# for the thin-installer E2E. It serves files under $Root by URL path so the
# download->verify->extract pipeline can be exercised with no external runtime
# (this replaces the previous undocumented `python -m http.server` dependency).
# TcpListener-based (no URL ACL / admin reservation). Stops when $StopFile appears.

$ErrorActionPreference = 'Stop'
$rootFull = [System.IO.Path]::GetFullPath($Root)
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()

function Write-Response {
  param($Stream, [string]$Status, [byte[]]$Body)
  if (-not $Body) { $Body = [byte[]]@() }
  $header = "HTTP/1.1 $Status`r`nContent-Length: $($Body.Length)`r`nConnection: close`r`nContent-Type: application/octet-stream`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if ($Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
  $Stream.Flush()
}

function Resolve-RequestedFile {
  # Map a URL path to a file strictly under $rootFull, or $null if it escapes.
  param([string]$UrlPath)
  $path = $UrlPath.Split('?')[0]
  $path = [System.Uri]::UnescapeDataString($path).TrimStart('/')
  if ([string]::IsNullOrWhiteSpace($path)) { return $null }
  $candidate = [System.IO.Path]::GetFullPath((Join-Path $rootFull $path))
  $boundary = $rootFull.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $candidate.StartsWith($boundary, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $null }
  return $candidate
}

try {
  while (-not (Test-Path -LiteralPath $StopFile)) {
    if (-not $listener.Pending()) { Start-Sleep -Milliseconds 25; continue }
    $client = $listener.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 2000
      $stream = $client.GetStream()
      $buffer = New-Object byte[] 8192
      $read = 0
      try { $read = $stream.Read($buffer, 0, $buffer.Length) } catch {}
      $requestLine = ''
      if ($read -gt 0) {
        $text = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $read)
        $requestLine = $text.Split("`r`n")[0]
      }
      $parts = $requestLine.Split(' ')
      if ($parts.Count -ge 2 -and $parts[0] -eq 'GET') {
        $file = Resolve-RequestedFile -UrlPath $parts[1]
        if ($file) {
          Write-Response -Stream $stream -Status '200 OK' -Body ([System.IO.File]::ReadAllBytes($file))
        }
        else {
          Write-Response -Stream $stream -Status '404 Not Found' -Body ([System.Text.Encoding]::ASCII.GetBytes('not found'))
        }
      }
      else {
        Write-Response -Stream $stream -Status '405 Method Not Allowed' -Body ([byte[]]@())
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
