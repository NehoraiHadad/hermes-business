# HermesEnv.ps1 — single source of truth for locating a Hermes install, reading
# its version, deciding whether it is compatible (fail-closed with guided copy),
# and waiting for the gateway/server to report healthy.
#
# Depends on: Logging.ps1 (Write-Step).

function Find-Hermes {
  # Resolves the hermes.exe that belongs to $HermesHome. When the home was NOT
  # explicitly chosen we also honour the historical default locations and PATH,
  # so an existing install is detected and preserved instead of reinstalled.
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$HermesHome,
    [switch]$HermesHomeWasExplicit
  )
  $candidates = @((Join-Path $HermesHome 'hermes-agent\venv\Scripts\hermes.exe'))
  if (-not $HermesHomeWasExplicit) {
    $candidates += @(
      (Join-Path $env:LOCALAPPDATA 'hermes\hermes-agent\venv\Scripts\hermes.exe'),
      (Join-Path $env:USERPROFILE '.hermes\hermes-agent\venv\Scripts\hermes.exe')
    )
  }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return [System.IO.Path]::GetFullPath($candidate)
    }
  }
  if ($HermesHomeWasExplicit) {
    # An explicit home must be self-contained: never fall back to a global CLI,
    # or an isolated install would silently reuse an unrelated global one.
    return $null
  }
  $command = Get-Command hermes.exe -ErrorAction SilentlyContinue
  if (-not $command) {
    $command = Get-Command hermes -ErrorAction SilentlyContinue
  }
  if ($command) {
    return $command.Source
  }
  return $null
}

function Get-HermesVersion {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$HermesExe)
  $text = (& $HermesExe --version 2>&1 | Out-String).Trim()
  $match = [regex]::Match($text, '\d+\.\d+\.\d+')
  if (-not $match.Success) {
    throw "Could not parse a Hermes version from: $text"
  }
  return [version]$match.Value
}

function Test-HermesVersionCompatible {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][version]$Version,
    [Parameter(Mandatory)][version]$Minimum,
    [Parameter(Mandatory)][version]$Maximum
  )
  return ($Version -ge $Minimum -and $Version -lt $Maximum)
}

function Assert-CompatibleVersion {
  # Fail-closed compatibility gate with operator-facing guidance. An install
  # outside the tested half-open range [Minimum, Maximum) is never modified.
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][version]$Version,
    [Parameter(Mandatory)][version]$Minimum,
    [Parameter(Mandatory)][version]$Maximum
  )
  if (Test-HermesVersionCompatible -Version $Version -Minimum $Minimum -Maximum $Maximum) {
    return
  }
  if ($Version -lt $Minimum) {
    throw @"
The detected Hermes $Version is older than the tested minimum $Minimum.
Your existing install has been left untouched. To continue, update Hermes to a
release in the range [$Minimum, $Maximum) using the official installer, then
re-run this bootstrap. No business components were changed.
"@
  }
  throw @"
The detected Hermes $Version is newer than this business bootstrap supports
(tested range [$Minimum, $Maximum)). Your existing install has been left
untouched. Install an updated business bootstrap that lists $Version as
supported, then re-run it. No business components were changed.
"@
}

function Wait-HermesHealth {
  # Bounded health wait. Polls a probe scriptblock (which returns $true when
  # healthy) until it succeeds or the timeout elapses. Used to gate on the
  # gateway/server actually being ready rather than assuming it after a call.
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][scriptblock]$Probe,
    [int]$TimeoutSec = 45,
    [int]$IntervalMs = 500,
    [string]$Description = 'Hermes health'
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $attempt = 0
  while ((Get-Date) -lt $deadline) {
    $attempt++
    try {
      if (& $Probe) {
        Write-Step "$Description became ready after $attempt attempt(s)."
        return $true
      }
    }
    catch {
      # Probe not ready yet; keep polling until the deadline.
    }
    Start-Sleep -Milliseconds $IntervalMs
  }
  throw "$Description did not become ready within $TimeoutSec seconds."
}
