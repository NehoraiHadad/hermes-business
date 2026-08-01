# CompanionInstall.ps1 — format-agnostic companion install TRANSACTION.
#
# BOTH the trusted NSIS installer AND the untrusted portable ZIP land the app via
# the SAME contract: the release manifest NAMES the executable (an 'entrypoint'),
# and we resolve it DETERMINISTICALLY. Nothing here ever scans the filesystem to
# guess which .exe is "ours" (no "largest exe wins" heuristic).
#
# The install is a transaction:
#   1. Validate the entrypoint SHAPE fail-closed BEFORE any mutation.
#   2. Move any prior companion aside so a failure can restore it byte-for-byte.
#   3. Run the format-specific InstallAction into the isolated install root.
#   4. Post-install CONTRACT: resolve the declared entrypoint and prove it exists
#      strictly inside that root.
#   5. On install-action OR contract failure, discard the partial install and
#      restore the previous companion intact.
# Only the companion's own install root is ever touched — the single shared Hermes
# home/state is never read or written here.
#
# Depends on: CompanionEntrypoint.ps1 (Assert-/Resolve-CompanionEntrypoint,
#             Get-CompanionInstallRoot), Logging.ps1 (Write-Step) when available.

function Invoke-CompanionInstall {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Entrypoint,
    [Parameter(Mandatory)][scriptblock]$InstallAction,
    [string]$InstallRoot
  )
  # 1. Fail-closed SHAPE validation BEFORE touching the filesystem: a hostile
  #    entrypoint (traversal/absolute/colon/UNC/non-exe) is rejected here, so a
  #    bad manifest never gets as far as moving the prior install aside.
  $relative = Assert-CompanionEntrypoint -Entrypoint $Entrypoint
  $root = [System.IO.Path]::GetFullPath((Get-CompanionInstallRoot -InstallRoot $InstallRoot))
  $parent = Split-Path -Parent $root
  if ([string]::IsNullOrWhiteSpace($parent)) {
    throw "Refusing to install the companion to a filesystem root: $root"
  }
  New-Item -ItemType Directory -Force -Path $parent | Out-Null

  # 2. Move any prior companion aside (same volume => atomic rename).
  $backup = $null
  if (Test-Path -LiteralPath $root -PathType Container) {
    $backup = "$root.prev-" + [guid]::NewGuid().ToString('N').Substring(0, 12)
    Move-Item -LiteralPath $root -Destination $backup -Force
  }
  try {
    # 3. Run the format-specific install into the now-empty isolated root.
    & $InstallAction $root
    # 4. Post-install CONTRACT: deterministic entrypoint resolution (no scan).
    $executable = Resolve-CompanionEntrypoint -InstallRoot $root -Entrypoint $relative
    if ($backup -and (Test-Path -LiteralPath $backup)) {
      Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue
    }
    return $executable
  }
  catch {
    # 5. Roll back: discard the partial install, restore the prior companion.
    if (Test-Path -LiteralPath $root) {
      Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($backup -and (Test-Path -LiteralPath $backup)) {
      Move-Item -LiteralPath $backup -Destination $root -Force
    }
    throw
  }
}
