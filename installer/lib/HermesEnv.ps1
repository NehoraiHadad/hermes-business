# HermesEnv.ps1 — single source of truth for locating a Hermes install, reading
# its version, deciding whether it is compatible (fail-closed with guided copy),
# and waiting for the gateway/server to report healthy.
#
# Depends on: Logging.ps1 (Write-Step); SemVer.ps1 (ConvertTo-BusinessSemVer,
#             Compare-BusinessSemVer) — the installed CLI's version string is
#             parsed and compared through the SAME grammar the companion
#             release contract already uses, instead of a second ad hoc
#             regex + [version] cast. The caller must dot-source SemVer.ps1
#             before this file's version functions are actually CALLED (both
#             bootstrap.ps1 and scripts/test-bootstrap-lib.ps1 do, via
#             bootstrap-companion.ps1 or directly).

function Test-HermesPathIsE2ETemp {
  # Mirrors electron/runtime-mode.cjs isTestPath (read-only reference; keep this
  # regex in lockstep with it): a hermes.exe resolved from PATH is rejected when
  # it sits under the OS temp directory AND its path contains one of the
  # E2E/QA sentinel segments Electron's own runtime uses to mark throwaway
  # isolated homes, so a stale E2E temp install can never win over — or masquerade
  # as — a real one.
  #
  # RESIDUAL RISK (documented, not eliminated): unlike electron/paths.cjs
  # (findHermes/resolveHermesBinary), which never consults PATH at all, this
  # thin network bootstrap still falls back to PATH when $HermesHome was NOT
  # explicitly chosen, and only after the documented install locations were
  # already checked and missed (see Find-Hermes). Any OTHER PATH entry — a
  # manually placed shim, a different Hermes fork, or a PATH-hijack outside the
  # temp directory — is still trusted if it resolves. This filter closes the
  # one concretely observed failure mode (a stale E2E temp dir winning), not
  # the general question of trusting PATH.
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Path)
  $full = [System.IO.Path]::GetFullPath($Path)
  $temp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  $separators = @([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
  $normalizedFull = $full.TrimEnd($separators)
  $normalizedTemp = $temp.TrimEnd($separators)
  $isUnderTemp = $normalizedFull.Equals($normalizedTemp, [System.StringComparison]::OrdinalIgnoreCase) -or
    $normalizedFull.StartsWith($normalizedTemp + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
  if (-not $isUnderTemp) { return $false }
  return $normalizedFull -match 'hermes-(business-e2e|qa-home|e2e-home)'
}

function Find-Hermes {
  # Resolves the hermes.exe that belongs to $HermesHome. When the home was NOT
  # explicitly chosen we also honour the historical default locations and PATH,
  # so an existing install is detected and preserved instead of reinstalled.
  # The documented install locations are always tried FIRST; PATH is the last
  # resort and a stale E2E/QA temp entry is rejected out of it (see
  # Test-HermesPathIsE2ETemp for the semantics and the residual risk that remain).
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
  if ($command -and -not (Test-HermesPathIsE2ETemp -Path $command.Source)) {
    return $command.Source
  }
  return $null
}

function ConvertTo-BusinessSemVerFromAny {
  # Normalizes a [version], a raw version string, or an already-parsed
  # SemVer.ps1 object into the SemVer.ps1 pscustomobject, so every caller of
  # Test-HermesVersionCompatible / Assert-CompatibleVersion below — whether
  # comparing an installed CLI's (possibly prerelease) version or a plain
  # official-release [version] (ReleaseSelection.ps1) — is routed through the
  # ONE parser/grammar in SemVer.ps1 instead of a second implementation.
  [CmdletBinding()]
  param([Parameter(Mandatory)]$Value)
  if ($Value -is [pscustomobject] -and $Value.PSObject.Properties.Match('core').Count -gt 0) {
    return $Value
  }
  return ConvertTo-BusinessSemVer ([string]$Value)
}

function Get-HermesVersion {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$HermesExe)
  $text = (& $HermesExe --version 2>&1 | Out-String).Trim()
  # Capture the version token including an optional prerelease suffix (e.g.
  # "0.19.1-alpha.2") so a prerelease build is never silently rounded down to
  # its release core before it even reaches the parser. The actual parsing and
  # grammar validation is delegated to ConvertTo-BusinessSemVer (SemVer.ps1) —
  # the same parser the companion release contract already uses — instead of a
  # second bespoke regex + [version] cast.
  $match = [regex]::Match($text, '\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?')
  if (-not $match.Success) {
    throw "Could not parse a Hermes version from: $text"
  }
  try {
    return ConvertTo-BusinessSemVer $match.Value
  }
  catch {
    throw "Could not parse a Hermes version from: $text"
  }
}

function Test-HermesVersionCompatible {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]$Version,
    [Parameter(Mandatory)]$Minimum,
    [Parameter(Mandatory)]$Maximum
  )
  $version = ConvertTo-BusinessSemVerFromAny $Version
  $minimum = ConvertTo-BusinessSemVerFromAny $Minimum
  $maximum = ConvertTo-BusinessSemVerFromAny $Maximum
  return ((Compare-BusinessSemVer $version $minimum) -ge 0 -and (Compare-BusinessSemVer $version $maximum) -lt 0)
}

function Assert-CompatibleVersion {
  # Fail-closed compatibility gate with operator-facing guidance. An install
  # outside the tested half-open range [Minimum, Maximum) is never modified.
  # The half-open range semantics (>=Minimum, <Maximum) are unchanged from the
  # previous [version]-only implementation; only the parser/comparator moved to
  # SemVer.ps1 (see Get-HermesVersion / ConvertTo-BusinessSemVerFromAny above).
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]$Version,
    [Parameter(Mandatory)]$Minimum,
    [Parameter(Mandatory)]$Maximum
  )
  if (Test-HermesVersionCompatible -Version $Version -Minimum $Minimum -Maximum $Maximum) {
    return
  }
  $detectedSemVer = ConvertTo-BusinessSemVerFromAny $Version
  $minimumSemVer = ConvertTo-BusinessSemVerFromAny $Minimum
  $maximumSemVer = ConvertTo-BusinessSemVerFromAny $Maximum
  $detected = $detectedSemVer.raw
  $minimumText = $minimumSemVer.raw
  $maximumText = $maximumSemVer.raw
  if ((Compare-BusinessSemVer $detectedSemVer $minimumSemVer) -lt 0) {
    throw @"
The detected Hermes $detected is older than the tested minimum $minimumText.
Your existing install has been left untouched. To continue, update Hermes to a
release in the range [$minimumText, $maximumText) using the official installer, then
re-run this bootstrap. No business components were changed.
"@
  }
  throw @"
The detected Hermes $detected is newer than this business bootstrap supports
(tested range [$minimumText, $maximumText)). Your existing install has been left
untouched. Install an updated business bootstrap that lists $detected as
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
