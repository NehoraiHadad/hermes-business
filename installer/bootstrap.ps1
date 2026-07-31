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
  [switch]$VerifyInstallerOnly
)

# bootstrap.ps1 — thin Windows network installer for the העוזר לעסק (Alpha) shell.
#
# It never bundles Hermes: it either detects a compatible existing install or
# downloads the newest official, tagged release inside the tested range and runs
# the official installer. All reusable logic lives in installer/lib/*.ps1; this
# file only wires those modules together and sequences the install.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$MinimumHermesVersion = [version]'0.19.0'
$MaximumHermesVersion = [version]'0.20.0'
$Repository = 'NousResearch/hermes-agent'
$BootstrapVersion = '0.3.3'

# --- Load the shared library (single source of truth for every primitive). ---
$LibraryRoot = Join-Path $PSScriptRoot 'lib'
foreach ($module in @('Logging.ps1', 'Hashing.ps1', 'HttpRetry.ps1', 'HttpDownload.ps1', 'FileOps.ps1', 'ZipPolicy.ps1', 'SafeZip.ps1', 'HermesEnv.ps1', 'Release.ps1', 'Payload.ps1')) {
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

function Install-BusinessPayload {
  param([Parameter(Mandatory)][string]$HermesExe)

  $pluginSource = Join-Path $PayloadRoot 'plugin.js'
  $skillSource = Join-Path $PayloadRoot 'business-bootstrap.SKILL.md'
  # The business-partner Skill ships in BOTH the packaged companion and this thin
  # bootstrap, installed to the canonical skills/<category>/<name>/SKILL.md path so
  # it is discoverable by Hermes (GET /api/skills) even without the companion.
  $partnerSkillSource = Join-Path $PayloadRoot 'business-partner.SKILL.md'
  $pluginDirectory = Join-Path $HermesHome 'desktop-plugins\business-shell'
  $files = @(
    @{ Source = $pluginSource;        Target = (Join-Path $pluginDirectory 'plugin.js') },
    @{ Source = $skillSource;         Target = (Join-Path $HermesHome 'skills\productivity\business-bootstrap\SKILL.md') },
    @{ Source = $partnerSkillSource;  Target = (Join-Path $HermesHome 'skills\business\business-partner\SKILL.md') }
  )

  # The WhatsApp reply-policy plugin ships as part of the same transactional unit
  # so that a failure to *enable* it rolls back the plugin + skill too.
  $policySource = Join-Path $PayloadRoot 'whatsapp-policy'
  $policyPresent = Test-Path -LiteralPath $policySource -PathType Container
  $activate = $null
  if ($policyPresent) {
    $policyTargetDir = Join-Path $HermesHome 'plugins\business-whatsapp-policy'
    foreach ($name in @('__init__.py', 'policy.py', 'ingest.py', 'contract.py', 'surface.py', 'guards.py', 'transport.py', 'registry.py', 'plugin.yaml')) {
      $files += @{ Source = (Join-Path $policySource $name); Target = (Join-Path $policyTargetDir $name) }
    }
    $activate = {
      Write-Step 'Activating the WhatsApp reply-policy plugin via `hermes plugins enable`.'
      & $HermesExe plugins enable business-whatsapp-policy --no-allow-tool-override
      if ($LASTEXITCODE -ne 0) {
        throw "Enabling the WhatsApp reply-policy plugin failed with exit code $LASTEXITCODE."
      }
    }
  }
  else {
    Write-Step "WhatsApp policy payload not present at $policySource; installing plugin + skill only."
  }

  $receiptExtra = [ordered]@{
    pluginSha256              = (Get-Sha256Hash -Path $pluginSource)
    bootstrapSkillSha256      = (Get-Sha256Hash -Path $skillSource)
    businessPartnerSkillSha256 = (Get-Sha256Hash -Path $partnerSkillSource)
    whatsAppPolicyIncluded    = $policyPresent
    whatsAppPolicyEnabled     = $policyPresent
    whatsAppPolicyFailClosed  = 'read_only'
  }

  Write-Step 'Installing the Hermes business plugin, first-run skill and reply-policy as one transaction.'
  Invoke-PayloadTransaction `
    -HermesHome $HermesHome `
    -Label 'business-shell' `
    -Files $files `
    -BootstrapVersion $BootstrapVersion `
    -ReceiptTarget (Join-Path $pluginDirectory 'install-receipt.json') `
    -Activate $activate `
    -ReceiptExtra $receiptExtra | Out-Null
}

function Ensure-Gateway {
  param([Parameter(Mandatory)][string]$HermesExe)
  Write-Step 'Checking the Hermes background gateway.'
  $statusOutput = (& $HermesExe gateway status 2>&1 | Out-String)
  $running = $LASTEXITCODE -eq 0 -and $statusOutput -match 'running'
  $startsOnLogin = $statusOutput -match 'login item installed|scheduled task (installed|registered)'
  if (-not ($running -and $startsOnLogin)) {
    Write-Step 'Installing and starting the official Hermes gateway service.'
    & $HermesExe gateway install --start-now --start-on-login
    if ($LASTEXITCODE -ne 0) {
      throw "Hermes gateway installation failed with exit code $LASTEXITCODE."
    }
  }

  # Bounded health wait: poll the deep status until it reports PASS.
  Wait-HermesHealth -Description 'Hermes gateway health check' -TimeoutSec 60 -IntervalMs 1000 -Probe {
    $deep = (& $HermesExe gateway status --deep 2>&1 | Out-String)
    return ($LASTEXITCODE -eq 0 -and $deep -match 'PASS')
  } | Out-Null
  Write-Step 'Hermes gateway health check passed.'
}

try {
  Write-Step "Starting Hermes Business bootstrap $BootstrapVersion."
  Write-Step "Hermes home: $HermesHome"

  if ($ResolveOnly) {
    Resolve-LatestCompatibleRelease -Repository $Repository -Minimum $MinimumHermesVersion -Maximum $MaximumHermesVersion -Headers (Get-Headers) |
      ConvertTo-Json -Compress
    exit 0
  }
  if ($VerifyInstallerOnly) {
    $resolved = Resolve-LatestCompatibleRelease -Repository $Repository -Minimum $MinimumHermesVersion -Maximum $MaximumHermesVersion -Headers (Get-Headers)
    $temporaryPath = Join-Path ([System.IO.Path]::GetTempPath()) "hermes-installer-$([guid]::NewGuid().ToString('N')).ps1"
    try {
      $blobSha = Save-VerifiedOfficialInstaller -Repository $Repository -Tag $resolved.tag -Destination $temporaryPath -Headers (Get-Headers)
      [ordered]@{
        tag     = $resolved.tag
        version = $resolved.version
        blobSha = $blobSha
        sha256  = (Get-Sha256Hash -Path $temporaryPath).ToUpperInvariant()
        size    = (Get-Item -LiteralPath $temporaryPath).Length
      } | ConvertTo-Json -Compress
      exit 0
    }
    finally {
      Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    }
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
  Write-Step "Compatible Hermes $version detected at $hermesExe."

  Assert-PluginSdkContract -HermesHome $HermesHome
  Install-BusinessPayload -HermesExe $hermesExe
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
