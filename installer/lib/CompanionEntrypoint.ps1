# CompanionEntrypoint.ps1 — install-root resolution and companion ENTRYPOINT
# validation. This is the "where does the app land, and which exe is legitimately
# ours?" half of the companion contract. Manifest/URL/checksum validation lives in
# CompanionManifest.ps1; download/extract orchestration lives in
# bootstrap-companion.ps1. Kept free of network/extraction I/O so it is trivially
# testable in isolation.
#
# Depends on: nothing (pure path policy).

function Get-CompanionInstallRoot {
  # The per-user location electron-builder's NSIS target installs into. Injectable
  # so an isolated test can point extraction/detection at a throwaway root instead
  # of the live user profile.
  param([string]$InstallRoot)
  if (-not [string]::IsNullOrWhiteSpace($InstallRoot)) {
    return [System.IO.Path]::GetFullPath($InstallRoot)
  }
  return Join-Path $env:LOCALAPPDATA 'Programs\hermes-business'
}

function Assert-CompanionEntrypoint {
  # Validate a manifest-declared entrypoint (NSIS *and* ZIP) as a path SHAPE (no
  # filesystem access yet). Must be a relative, single, unambiguous *.exe under
  # the install root — rejecting absolute/drive/UNC/traversal/colon(ADS)/backslash
  # tricks and directory markers. Returns the forward-slash-normalized relative
  # path. This replaces the former "largest recursive exe wins" scan: the
  # installed executable is NAMED by the manifest, never guessed off the disk.
  param([string]$Entrypoint)
  if ([string]::IsNullOrWhiteSpace($Entrypoint)) {
    throw "A companion release must declare an 'entrypoint' (relative path to the app .exe)."
  }
  $value = $Entrypoint.Trim()
  if ($value.IndexOf('\') -ge 0) { throw "The companion entrypoint must use '/' separators, not '\': '$Entrypoint'." }
  if ($value.IndexOf(':') -ge 0) { throw "The companion entrypoint must not contain a colon (drive/ADS): '$Entrypoint'." }
  if ($value.StartsWith('/') -or [System.IO.Path]::IsPathRooted($value)) {
    throw "The companion entrypoint must be a relative path, not absolute: '$Entrypoint'."
  }
  if ($value.EndsWith('/')) { throw "The companion entrypoint must be a file, not a directory: '$Entrypoint'." }
  $segments = @($value.Split('/') | Where-Object { $_ -ne '' })
  if ($segments.Count -eq 0) { throw "The companion entrypoint is empty after normalization: '$Entrypoint'." }
  foreach ($segment in $segments) {
    if ($segment -eq '..' -or $segment -eq '.') {
      throw "The companion entrypoint must not contain path traversal: '$Entrypoint'."
    }
  }
  if (-not ($segments[-1].ToLowerInvariant().EndsWith('.exe'))) {
    throw "The companion entrypoint must name a .exe: '$Entrypoint'."
  }
  return ($segments -join '/')
}

function Resolve-CompanionEntrypoint {
  # Resolve the validated entrypoint under the extracted install root and prove it
  # exists as a single file strictly inside that root. Deterministic — never a
  # "largest exe wins" scan of attacker-controlled content.
  param([string]$InstallRoot, [string]$Entrypoint)
  $relative = Assert-CompanionEntrypoint -Entrypoint $Entrypoint
  $rootFull = [System.IO.Path]::GetFullPath((Get-CompanionInstallRoot -InstallRoot $InstallRoot))
  $target = [System.IO.Path]::GetFullPath((Join-Path $rootFull ($relative -replace '/', [System.IO.Path]::DirectorySeparatorChar)))
  $boundary = $rootFull.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not ($target.StartsWith($boundary, [System.StringComparison]::OrdinalIgnoreCase))) {
    throw "The companion entrypoint resolves outside the install root: '$Entrypoint'."
  }
  if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
    throw "The companion entrypoint '$Entrypoint' does not exist after extraction."
  }
  return $target
}
