#Requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$PayloadRoot,
  [string]$HermesHome = '',
  [switch]$SkipHermesInstall,
  [switch]$SkipGatewaySetup,
  [switch]$SkipCompanionInstall,
  [string]$CompanionManifestUrl = '',
  [string]$CompanionInstallRoot = '',
  [switch]$AllowInsecureCompanionUrl,
  [switch]$NoLaunch,
  [switch]$ResolveOnly,
  [switch]$VerifyInstallerOnly,
  [string]$BootstrapVersion = ''
)

# bootstrap.ps1 — thin Windows network installer for the תכל'ס (Alpha) shell.
#
# It never bundles Hermes: it either detects a compatible existing install or
# downloads the newest official, tagged release inside the tested range and runs
# the official installer. All reusable logic lives in installer/lib/*.ps1; this
# file only wires those modules together and sequences the install.

$ErrorActionPreference = 'Stop'
# Uninitialized-variable reads (a typo'd $variable name silently evaluating to
# $null) fail loudly instead of drifting into a wrong path/URL/comparison. Only
# THIS entry point sets it: bootstrap-companion.ps1 is also dot-sourced by the
# offline unit-test runner (scripts/test-bootstrap-lib.ps1) directly, and
# Set-StrictMode set inside a dot-sourced file mutates the CALLER's scope too —
# turning it on there would silently flip strict mode on for that unrelated
# harness. Every module dot-sourced below (including bootstrap-companion.ps1)
# still runs under strict mode when reached through THIS script, because
# dot-sourcing executes in the current scope.
Set-StrictMode -Version Latest
$ProgressPreference = 'SilentlyContinue'

$MinimumHermesVersion = [version]'0.19.0'
$MaximumHermesVersion = [version]'0.21.0'
$Repository = 'NousResearch/hermes-agent'
if ([string]::IsNullOrWhiteSpace($BootstrapVersion)) {
  $packagePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'package.json'
  if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
    throw 'BootstrapVersion is required outside the source checkout.'
  }
  $BootstrapVersion = [string](Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json).version
}

# --- Load the shared library (single source of truth for every primitive). ---
$LibraryRoot = Join-Path $PSScriptRoot 'lib'
foreach ($module in @('Logging.ps1', 'Hashing.ps1', 'HttpRetry.ps1', 'HttpDownload.ps1', 'FileOps.ps1', 'ZipPolicy.ps1', 'SafeZip.ps1', 'SemVer.ps1', 'HermesEnv.ps1', 'Release.ps1', 'Payload.ps1', 'VerifyMode.ps1', 'BackendEnable.ps1', 'BusinessInstall.ps1')) {
  $modulePath = Join-Path $LibraryRoot $module
  if (-not (Test-Path -LiteralPath $modulePath -PathType Leaf)) {
    throw "Required installer module is missing: $modulePath"
  }
  . $modulePath
}

$HermesHomeWasExplicit = -not [string]::IsNullOrWhiteSpace($HermesHome)
if (-not $HermesHomeWasExplicit) {
  $HermesHome = Join-Path $env:LOCALAPPDATA 'hermes'
}
$HermesHome = [System.IO.Path]::GetFullPath($HermesHome)
# Every Hermes CLI invocation in this bootstrap must operate on the exact
# installation selected above, including plugin enablement and gateway setup.
$env:HERMES_HOME = $HermesHome

Initialize-BootstrapLog -Directory (Join-Path $env:LOCALAPPDATA 'HermesBusinessBootstrap') | Out-Null

function Get-Headers {
  return Get-GitHubApiHeaders -UserAgent "Hermes-Business-Bootstrap/$BootstrapVersion"
}

try {
  Write-Step "Starting Hermes Business bootstrap $BootstrapVersion."
  Write-Step "Hermes home: $HermesHome"

  if ($ResolveOnly -or $VerifyInstallerOnly) {
    Invoke-VerificationOnlyMode -ResolveOnly:$ResolveOnly -VerifyInstallerOnly:$VerifyInstallerOnly `
      -Repository $Repository -Minimum $MinimumHermesVersion -Maximum $MaximumHermesVersion -Headers (Get-Headers)
  }

  if ([string]::IsNullOrWhiteSpace($PayloadRoot)) {
    throw 'PayloadRoot is required unless a verification-only mode is used.'
  }

  if (-not $SkipCompanionInstall) {
    $companionModule = Join-Path $PSScriptRoot 'bootstrap-companion.ps1'
    if (-not (Test-Path -LiteralPath $companionModule -PathType Leaf)) {
      $companionModule = Join-Path $PayloadRoot 'bootstrap-companion.ps1'
    }
    if (-not (Test-Path -LiteralPath $companionModule -PathType Leaf)) {
      throw "Companion installer module is missing: $companionModule"
    }
    . $companionModule
  }

  $hermesExe = Find-Hermes -HermesHome $HermesHome -HermesHomeWasExplicit:$HermesHomeWasExplicit
  if (-not $hermesExe -and -not $SkipHermesInstall) {
    Install-LatestCompatibleHermes `
      -Repository $Repository `
      -Minimum $MinimumHermesVersion `
      -Maximum $MaximumHermesVersion `
      -HermesHome $HermesHome `
      -Headers (Get-Headers)
    $hermesExe = Find-Hermes -HermesHome $HermesHome -HermesHomeWasExplicit:$HermesHomeWasExplicit
  }
  if (-not $hermesExe) {
    throw 'Hermes is not installed and installation was skipped or did not complete.'
  }

  $version = Get-HermesVersion -HermesExe $hermesExe
  # Fail closed on an out-of-range version; a compatible existing install is
  # preserved and used as-is.
  Assert-CompatibleVersion -Version $version -Minimum $MinimumHermesVersion -Maximum $MaximumHermesVersion
  # $version is a SemVer.ps1 object (ConvertTo-BusinessSemVer); interpolating it
  # directly would print PowerShell's default @{...} property dump, so use the
  # normalized display string explicitly.
  Write-Step "Compatible Hermes $($version.raw) detected at $hermesExe."

  Assert-PluginSdkContract -HermesHome $HermesHome
  Install-BusinessPayload -HermesExe $hermesExe -PayloadRoot $PayloadRoot -HermesHome $HermesHome -BootstrapVersion $BootstrapVersion
  if (-not $SkipGatewaySetup) {
    Ensure-Gateway -HermesExe $hermesExe
  }

  $companionExe = $null
  if (-not $SkipCompanionInstall) {
    $companionExe = Install-BusinessCompanion `
      -PayloadRoot $PayloadRoot `
      -ManifestUrl $CompanionManifestUrl `
      -InstallRoot $CompanionInstallRoot `
      -AllowInsecureUrl:$AllowInsecureCompanionUrl
  }

  if (-not $NoLaunch) {
    if ($companionExe) {
      Write-Step 'Opening the business companion.'
      Start-Process -FilePath $companionExe -WindowStyle Hidden
    }
    else {
      Write-Step 'Opening Hermes Desktop. Choose the business assistant item to begin guided setup.'
      Start-Process -FilePath $hermesExe -ArgumentList 'desktop' -WindowStyle Hidden
    }
  }

  Write-Step 'Bootstrap completed successfully.'
  exit 0
}
catch {
  Write-Step "ERROR: $($_.Exception.Message)"
  Write-Error $_
  exit 1
}
