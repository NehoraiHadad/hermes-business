# BusinessInstall.ps1 — the local install steps the bootstrap runs once a
# compatible Hermes is detected: installing the business payload (plugin, skills
# and reply-policy plugin) as one transaction, and ensuring the background
# gateway is running and healthy. Dot-sourced by bootstrap.ps1, so these read
# $PayloadRoot / $HermesHome from the script scope exactly as when inline.

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
    foreach ($name in @('__init__.py', 'policy.py', 'ingest.py', 'contract.py', 'surface.py', 'guards.py', 'transport.py', 'registry.py', 'guard_core.py', 'surface_core.py', 'dispatch.py', 'telegram_policy.py', 'telegram_contract.py', 'telegram_surface.py', 'telegram_transport.py', 'telegram_registry.py', 'plugin.yaml')) {
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
