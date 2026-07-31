# SafeZip.ps1 — fail-closed ZIP EXTRACTION + atomic promotion for UNTRUSTED
# companion payloads. The per-entry POLICY (path shape, resolved-target boundary,
# reserved names, symlink/reparse rejection) lives in ZipPolicy.ps1; this module
# owns only the extraction/promotion transaction that consumes those decisions. It:
#   * validates EVERY entry (via Resolve-SafeZipTarget / Test-ZipEntryIsSymlink)
#     BEFORE writing a byte;
#   * extracts into a STAGING sibling directory, then atomically promotes it over
#     the destination only after the whole archive validated and extracted;
#   * cleans up staging (and restores any prior install) on ANY failure.
#
# Depends on: ZipPolicy.ps1 (Resolve-SafeZipTarget, Test-ZipEntryIsSymlink),
#             Logging.ps1 (Write-Step) when available; otherwise silent.

Add-Type -AssemblyName System.IO.Compression | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null

function Expand-ArchiveSafely {
  # Safe replacement for Expand-Archive. Validates the WHOLE archive, extracts to
  # a staging sibling, then atomically promotes over $Destination. Nothing is
  # written to $Destination unless every entry passed validation and extraction.
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$ArchivePath,
    [Parameter(Mandatory)][string]$Destination,
    [long]$MaxTotalBytes = 1GB,
    [int]$MaxEntries = 4096
  )
  if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
    throw "The archive to extract is missing: $ArchivePath"
  }
  $destFull = [System.IO.Path]::GetFullPath($Destination)
  $parent = Split-Path -Parent $destFull
  if (-not $parent) { throw "Refusing to extract to a root path: $destFull" }
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $staging = Join-Path $parent (".hermes-zip-stage-" + [guid]::NewGuid().ToString('N').Substring(0, 12))

  try {
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    $stagingFull = [System.IO.Path]::GetFullPath($staging)
    $zip = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
      if ($zip.Entries.Count -gt $MaxEntries) {
        throw "The archive has $($zip.Entries.Count) entries (over the $MaxEntries ceiling)."
      }
      # --- Pass 1: validate EVERY entry before writing a single byte. ----------
      $plan = @()
      $declaredTotal = 0L
      foreach ($entry in $zip.Entries) {
        if (Test-ZipEntryIsSymlink -Entry $entry) {
          throw "Refusing a symlink/reparse zip entry: '$($entry.FullName)'."
        }
        $resolved = Resolve-SafeZipTarget -EntryName $entry.FullName -DestinationFull $stagingFull
        if ($null -eq $resolved) { continue }
        $declaredTotal += [long]$entry.Length
        if ($declaredTotal -gt $MaxTotalBytes) {
          throw "The archive's uncompressed size exceeds the $MaxTotalBytes byte ceiling (possible zip bomb)."
        }
        $plan += [pscustomobject]@{ Entry = $entry; Target = $resolved.Target; IsDirectory = $resolved.IsDirectory }
      }
      # --- Pass 2: extract into staging only (validated targets). ---------------
      foreach ($item in $plan) {
        if ($item.IsDirectory) {
          New-Item -ItemType Directory -Force -Path $item.Target | Out-Null
          continue
        }
        $entryParent = Split-Path -Parent $item.Target
        if ($entryParent) { New-Item -ItemType Directory -Force -Path $entryParent | Out-Null }
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($item.Entry, $item.Target, $true)
      }
    }
    finally {
      $zip.Dispose()
    }

    # --- Atomic promote: swap staging over the destination on the same volume. --
    if (Test-Path -LiteralPath $destFull) {
      $backup = "$destFull.old-" + [guid]::NewGuid().ToString('N').Substring(0, 8)
      Move-Item -LiteralPath $destFull -Destination $backup -Force
      try {
        Move-Item -LiteralPath $staging -Destination $destFull -Force
      }
      catch {
        Move-Item -LiteralPath $backup -Destination $destFull -Force  # restore prior install
        throw
      }
      Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue
    }
    else {
      Move-Item -LiteralPath $staging -Destination $destFull -Force
    }
    return $destFull
  }
  catch {
    if (Test-Path -LiteralPath $staging) {
      Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
    }
    throw
  }
}
