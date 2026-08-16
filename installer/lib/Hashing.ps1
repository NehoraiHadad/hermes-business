# Hashing.ps1 — single source of truth for every checksum the bootstrap needs.
#
# Two flavours are required:
#   * Get-Sha256Hash    — content integrity for downloads and installed payload.
#   * Get-GitBlobSha1   — reproduces GitHub's `git hash-object` blob SHA-1 so a
#                         file fetched from the Contents/Blobs API can be checked
#                         against the immutable object id GitHub advertises.
#
# Everything returns lower-case hex so callers can compare without re-casing.

function Get-Sha256Hash {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]
    [string]$Path
  )
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Cannot hash a file that does not exist: $Path"
  }
  # Use the framework directly instead of depending on the optional
  # Microsoft.PowerShell.Utility Get-FileHash command. Minimal/embedded Windows
  # PowerShell hosts can omit that command even though the same machine exposes
  # it in an interactive shell; the installer must hash identically in both.
  $stream = [System.IO.File]::OpenRead([System.IO.Path]::GetFullPath($Path))
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
  }
  finally {
    $sha256.Dispose()
    $stream.Dispose()
  }
}

function Get-GitBlobSha1 {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]
    [byte[]]$Content
  )
  # Git hashes "blob <byte-length>\0<content>".
  $prefix = [System.Text.Encoding]::UTF8.GetBytes("blob $($Content.Length)`0")
  $payload = New-Object byte[] ($prefix.Length + $Content.Length)
  [System.Buffer]::BlockCopy($prefix, 0, $payload, 0, $prefix.Length)
  [System.Buffer]::BlockCopy($Content, 0, $payload, $prefix.Length, $Content.Length)
  $sha1 = [System.Security.Cryptography.SHA1]::Create()
  try {
    return ([System.BitConverter]::ToString($sha1.ComputeHash($payload))).Replace('-', '').ToLowerInvariant()
  }
  finally {
    $sha1.Dispose()
  }
}

function Assert-Sha256Match {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Expected,
    [string]$What = 'file'
  )
  $normalizedExpected = $Expected.Trim().ToLowerInvariant()
  if ($normalizedExpected -notmatch '^[0-9a-f]{64}$') {
    throw "A full SHA-256 hash is required to verify the $What."
  }
  $actual = Get-Sha256Hash -Path $Path
  if ($actual -ne $normalizedExpected) {
    throw "SHA-256 mismatch for the $What. Expected $normalizedExpected, received $actual. The download may be truncated or tampered with."
  }
  return $actual
}
