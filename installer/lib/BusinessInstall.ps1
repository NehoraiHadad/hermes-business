# BusinessInstall.ps1 — the local install steps the bootstrap runs once a
# compatible Hermes is detected: installing the business payload (plugin, skills
# and reply-policy plugin) as one transaction, and ensuring the background
# gateway is running and healthy. Dot-sourced by bootstrap.ps1; every value a
# function here needs (PayloadRoot, HermesHome, BootstrapVersion, HermesExe) is
# an EXPLICIT parameter passed by the caller — nothing in this file relies on
# reading a variable left behind in the caller's script scope.

function Install-BusinessPayload {
  param(
    [Parameter(Mandatory)][string]$HermesExe,
    [Parameter(Mandatory)][string]$PayloadRoot,
    [Parameter(Mandatory)][string]$HermesHome,
    [Parameter(Mandatory)][string]$BootstrapVersion
  )

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

  # Community tooling is callable by the official admin Hermes, but it always
  # provisions a SEPARATE pinned engine + HERMES_HOME. The patched observer is
  # therefore never mixed into, or selected as an update for, the official
  # business runtime.
  $communitySource = Join-Path $PayloadRoot 'community'
  if (-not (Test-Path -LiteralPath $communitySource -PathType Container)) {
    throw "The community runtime payload is missing at $communitySource. No changes were made."
  }
  $communityTarget = Join-Path $HermesHome 'tachles\community'
  $communityPayloadFiles = @(Get-ChildItem -LiteralPath $communitySource -File -Recurse)
  if ($communityPayloadFiles.Count -eq 0) {
    throw "The community runtime payload is empty at $communitySource. No changes were made."
  }
  foreach ($sourceFile in $communityPayloadFiles) {
    $relative = $sourceFile.FullName.Substring($communitySource.Length).TrimStart('\', '/')
    $files += @{ Source = $sourceFile.FullName; Target = (Join-Path $communityTarget $relative) }
  }

  if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw 'LOCALAPPDATA is unavailable; cannot choose an isolated community runtime root. No changes were made.'
  }
  $communityInstallRoot = Join-Path $env:LOCALAPPDATA 'TachlesCommunity'
  $communityHome = Join-Path $communityInstallRoot 'home'
  $communityContract = Join-Path $communityInstallRoot 'community.yaml'
  $communityGenerator = Join-Path $communityTarget 'scripts\community-generate.mjs'
  $communityProvisioner = Join-Path $communityTarget 'scripts\community-provision.mjs'
  foreach ($skillName in @('community-bootstrap', 'community-admin')) {
    $template = Join-Path $communitySource "assets\community-skills\$skillName\SKILL.md"
    if (-not (Test-Path -LiteralPath $template -PathType Leaf)) {
      throw "The community Skill template is missing: $template. No changes were made."
    }
    $rendered = Get-Content -Raw -LiteralPath $template
    $rendered = $rendered.Replace('{{HOME_DIR}}', $communityHome)
    $rendered = $rendered.Replace('{{CONTRACT_PATH}}', $communityContract)
    $rendered = $rendered.Replace('{{INSTALL_ROOT}}', $communityInstallRoot)
    $rendered = $rendered.Replace('{{GENERATE_CLI}}', $communityGenerator)
    $rendered = $rendered.Replace('{{PROVISION_CLI}}', $communityProvisioner)
    if ($rendered -match '\{\{[A-Z_]+\}\}') {
      throw "The rendered $skillName Skill still contains an unresolved placeholder. No changes were made."
    }
    $renderedSource = Join-Path $PayloadRoot ".$skillName.rendered.SKILL.md"
    [IO.File]::WriteAllText($renderedSource, $rendered, (New-Object Text.UTF8Encoding($false)))
    $files += @{
      Source = $renderedSource
      Target = (Join-Path $HermesHome "skills\community\$skillName\SKILL.md")
    }
  }

  # The WhatsApp reply-policy plugin ships as part of the same transactional unit
  # so that a failure to *enable* it rolls back the plugin + skill too.
  $policySource = Join-Path $PayloadRoot 'whatsapp-policy'
  $policyPresent = Test-Path -LiteralPath $policySource -PathType Container
  # Assigned unconditionally (not just inside the `if` below) so the obsolete-
  # module prune near the end of this function never depends on a variable
  # that only exists inside a sibling `if` block — both consumers still gate
  # on $policyPresent, but the value itself is never in doubt.
  $policyTargetDir = Join-Path $HermesHome 'plugins\business-whatsapp-policy'
  if ($policyPresent) {
    foreach ($name in @('__init__.py', 'policy.py', 'ingest.py', 'contract.py', 'surface.py', 'guards.py', 'transport.py', 'registry.py', 'guard_core.py', 'surface_core.py', 'dispatch.py', 'families.py', 'egress.py', 'tool_hook.py', 'tool_transport.py', 'tool_contract.py', 'guard_status.py', 'plugin.yaml')) {
      $files += @{ Source = (Join-Path $policySource $name); Target = (Join-Path $policyTargetDir $name) }
    }
  }
  else {
    Write-Step "WhatsApp policy payload not present at $policySource; installing plugin + skill only."
  }

  # READ-ONLY companion backend (dashboard/manifest.json + plugin_api.py) — the
  # paused-inclusive source of truth. It rides the SAME transaction so that a
  # failure to enable it (or its health check) rolls back the desktop plugin,
  # skill and policy together, AND the config enablement is restored (see the
  # Backup/Restore-HermesConfig around the activate below).
  $backendPresent = Test-DashboardPayloadPresent -PayloadRoot $PayloadRoot
  if ($backendPresent) {
    $files += Get-DashboardPayloadFiles -PayloadRoot $PayloadRoot -HermesHome $HermesHome
  }
  else {
    Write-Step "Companion backend payload not present at $PayloadRoot\dashboard; installing without the paused-inclusive door."
  }

  # Single activation for the whole unit. Config.yaml is snapshotted first so
  # enabling either plugin can be rolled back atomically with the files.
  $activate = {
    $configBackup = Backup-HermesConfig -HermesHome $HermesHome
    try {
      if ($policyPresent) {
        Write-Step 'Activating the WhatsApp reply-policy plugin via `hermes plugins enable`.'
        & $HermesExe plugins enable business-whatsapp-policy --no-allow-tool-override
        if ($LASTEXITCODE -ne 0) {
          throw "Enabling the WhatsApp reply-policy plugin failed with exit code $LASTEXITCODE."
        }
      }
      if ($backendPresent) {
        Enable-DashboardPluginInConfig -HermesHome $HermesHome -PluginId 'business-shell'
        Assert-BackendHealthy -HermesHome $HermesHome -PluginId 'business-shell'
      }
    }
    catch {
      Restore-HermesConfig -Backup $configBackup
      throw
    }
  }

  $receiptExtra = [ordered]@{
    pluginSha256              = (Get-Sha256Hash -Path $pluginSource)
    bootstrapSkillSha256      = (Get-Sha256Hash -Path $skillSource)
    businessPartnerSkillSha256 = (Get-Sha256Hash -Path $partnerSkillSource)
    whatsAppPolicyIncluded    = $policyPresent
    whatsAppPolicyEnabled     = $policyPresent
    whatsAppPolicyFailClosed  = 'read_only'
    companionBackendIncluded  = $backendPresent
    companionBackendEnabled   = $backendPresent
    communityRuntimeIncluded  = $true
    communityRuntimeFileCount = $communityPayloadFiles.Count
    dashboardManifestSha256   = if ($backendPresent) { Get-Sha256Hash -Path (Join-Path $PayloadRoot 'dashboard\manifest.json') } else { $null }
    dashboardApiSha256        = if ($backendPresent) { Get-Sha256Hash -Path (Join-Path $PayloadRoot 'dashboard\plugin_api.py') } else { $null }
  }

  Write-Step 'Installing the Hermes business plugin, first-run skill, reply-policy and companion backend as one transaction.'
  Invoke-PayloadTransaction `
    -HermesHome $HermesHome `
    -Label 'business-shell' `
    -Files $files `
    -BootstrapVersion $BootstrapVersion `
    -ReceiptTarget (Join-Path $pluginDirectory 'install-receipt.json') `
    -Activate $activate `
    -ReceiptExtra $receiptExtra | Out-Null

  # Version 0.2 delegates Telegram entirely to Hermes. Prune only the exact
  # retired modules after the replacement payload committed successfully.
  if ($policyPresent) {
    foreach ($obsolete in @('telegram_policy.py', 'telegram_contract.py', 'telegram_surface.py', 'telegram_transport.py', 'telegram_registry.py')) {
      $obsoletePath = Join-Path $policyTargetDir $obsolete
      if (Test-Path -LiteralPath $obsoletePath -PathType Leaf) {
        Remove-Item -LiteralPath $obsoletePath -Force
      }
    }
  }
}

function Ensure-Gateway {
  param([Parameter(Mandatory)][string]$HermesExe)
  Write-Step 'Checking the Hermes background gateway.'
  $statusOutput = (& $HermesExe gateway status 2>&1 | Out-String)
  # `hermes gateway status` has no machine-readable --json flag (checked the
  # installed CLI's hermes_cli/subcommands/gateway.py) and its exit code carries
  # no state either: hermes_cli/gateway_windows.py's status() prints and returns
  # normally (exit 0) even when nothing is installed or running. Only a positive
  # TEXT match may decide state — this mirrors electron/gateway-status.cjs's
  # fail-closed RUNNING_RE, anchored on "running (PID" (never a bare 'running'
  # substring, which could also match unrelated log/status noise) so it matches
  # every phrasing gateway_windows.py prints ("Gateway process running (PID: ..)",
  # and the cross-platform "Gateway already running (PID: ..)"/"Gateway is
  # running (PID: ..)"). PowerShell's -match is case-insensitive by default.
  $running = $LASTEXITCODE -eq 0 -and $statusOutput -match 'gateway[^\r\n]*running \(pid'
  # Both known positive phrasings from hermes_cli/gateway_windows.py status():
  # "Windows login item installed: <path>" and "Scheduled Task registered:
  # <name>". Tolerated together in case a future CLI version renames one.
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
