# ZipPolicy.ps1 — fail-closed ENTRY POLICY for untrusted companion ZIP payloads.
#
# This module owns the "is this entry allowed, and where would it land?" decision
# for every archive entry, in isolation from any extraction I/O (that lives in
# SafeZip.ps1). A hostile zip can carry entries like `..\..\state.db`, `C:\evil.exe`,
# `\\host\share\x`, an NTFS ADS name (`file:stream`), a reserved device name, or a
# symlink/reparse entry that write OUTSIDE the intended destination ("zip-slip").
# Every predicate here refuses all of those BEFORE a byte is written.
#
# Depends on: nothing (pure path/attribute policy). Loads System.IO.Compression so
# the ZipArchiveEntry-typed parameter binds under Windows PowerShell 5.1.

Add-Type -AssemblyName System.IO.Compression | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null

$script:ReservedDeviceNames = @(
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
)

function Test-ZipEntryIsSymlink {
  # Detect a symlink/reparse entry by its stored attributes: the Unix mode lives
  # in the high 16 bits of ExternalAttributes (S_IFLNK = 0xA000); the DOS/Windows
  # reparse bit (0x400) lives in the low bits. Either one is rejected outright.
  param([System.IO.Compression.ZipArchiveEntry]$Entry)
  $ext = [uint32]$Entry.ExternalAttributes
  $unixMode = ($ext -shr 16) -band 0xF000
  if ($unixMode -eq 0xA000) { return $true }               # S_IFLNK
  if (($ext -band 0x400) -ne 0) { return $true }           # FILE_ATTRIBUTE_REPARSE_POINT
  return $false
}

function Resolve-SafeZipTarget {
  # Validates a single archive entry name and returns the absolute target path
  # under $DestinationFull, or throws. $DestinationFull MUST already be a
  # normalized full path. Returns $null for a pure directory entry marker.
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$EntryName,
    [Parameter(Mandatory)][string]$DestinationFull
  )
  if ([string]::IsNullOrWhiteSpace($EntryName)) {
    throw "Refusing a zip entry with an empty name."
  }
  # The zip spec mandates '/' as the separator; a literal backslash is either a
  # Windows traversal attempt or an ambiguous name. Reject before normalizing.
  if ($EntryName.IndexOf('\') -ge 0) {
    throw "Refusing a zip entry containing a backslash: '$EntryName'."
  }
  # A colon anywhere means a drive qualifier (C:\) or an NTFS alternate data
  # stream (file.txt:hidden) — both escape the by-name contract.
  if ($EntryName.IndexOf(':') -ge 0) {
    throw "Refusing a zip entry containing a colon (drive/ADS): '$EntryName'."
  }
  # Leading '/' (absolute-from-root) or any UNC-looking prefix.
  if ($EntryName.StartsWith('/')) {
    throw "Refusing an absolute zip entry: '$EntryName'."
  }
  if ([System.IO.Path]::IsPathRooted($EntryName)) {
    throw "Refusing a rooted zip entry: '$EntryName'."
  }
  $isDirectory = $EntryName.EndsWith('/')
  $segments = @($EntryName.Split('/') | Where-Object { $_ -ne '' })
  foreach ($segment in $segments) {
    if ($segment -eq '..') {
      throw "Refusing a path-traversal zip entry: '$EntryName'."
    }
    $base = $segment.Split('.')[0]
    if ($script:ReservedDeviceNames -contains $base.ToUpperInvariant()) {
      throw "Refusing a reserved Windows device name in a zip entry: '$EntryName'."
    }
  }
  if ($segments.Count -eq 0) { return $null }  # e.g. a bare '/' marker
  $relative = ($segments -join [System.IO.Path]::DirectorySeparatorChar)
  $combined = [System.IO.Path]::GetFullPath((Join-Path $DestinationFull $relative))
  # Final defense: the RESOLVED target must live strictly under the destination.
  $boundary = $DestinationFull.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not ($combined + [System.IO.Path]::DirectorySeparatorChar).StartsWith($boundary, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing a zip entry that resolves outside the destination: '$EntryName' -> '$combined'."
  }
  return [pscustomobject]@{ Target = $combined; IsDirectory = $isDirectory }
}
