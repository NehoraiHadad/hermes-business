[CmdletBinding()]
param([switch]$Keep)

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$temporaryParent = [System.IO.Path]::GetFullPath((Join-Path ([System.IO.Path]::GetTempPath()) 'hermes-business-e2e'))
$testRoot = [System.IO.Path]::GetFullPath((Join-Path $temporaryParent "hb-$([guid]::NewGuid().ToString('N').Substring(0, 8))"))
$payloadRoot = Join-Path $testRoot 'payload'
$hermesHome = Join-Path $testRoot 'home'

if (-not $testRoot.StartsWith($temporaryParent + [System.IO.Path]::DirectorySeparatorChar)) {
  throw "Refusing to use a clean-install directory outside $temporaryParent"
}

New-Item -ItemType Directory -Force -Path $payloadRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'hermes-plugin\business-shell\plugin.js') `
  -Destination (Join-Path $payloadRoot 'plugin.js')
Copy-Item -LiteralPath (Join-Path $root 'hermes-plugin\business-shell\skills\business-bootstrap\SKILL.md') `
  -Destination (Join-Path $payloadRoot 'business-bootstrap.SKILL.md')
Copy-Item -LiteralPath (Join-Path $root 'installer\bootstrap-companion.ps1') `
  -Destination (Join-Path $payloadRoot 'bootstrap-companion.ps1')

# Companion backend payload (paused-inclusive source of truth) — installed +
# enabled inside the business-shell transaction by the bootstrap.
$dashboardPayload = Join-Path $payloadRoot 'dashboard'
New-Item -ItemType Directory -Force -Path $dashboardPayload | Out-Null
foreach ($backendFile in @('manifest.json', 'plugin_api.py')) {
  Copy-Item -LiteralPath (Join-Path $root "hermes-plugin\business-shell\dashboard\$backendFile") `
    -Destination (Join-Path $dashboardPayload $backendFile)
}

$policyPayload = Join-Path $payloadRoot 'whatsapp-policy'
New-Item -ItemType Directory -Force -Path $policyPayload | Out-Null
foreach ($policyFile in @('__init__.py', 'policy.py', 'ingest.py', 'contract.py', 'surface.py', 'guards.py', 'transport.py', 'registry.py', 'guard_core.py', 'surface_core.py', 'dispatch.py', 'families.py', 'egress.py', 'tool_hook.py', 'tool_transport.py', 'tool_contract.py', 'guard_status.py', 'plugin.yaml')) {
  Copy-Item -LiteralPath (Join-Path $root "hermes-plugin\business-whatsapp-policy\$policyFile") `
    -Destination (Join-Path $policyPayload $policyFile)
}
$communityPayload = Join-Path $payloadRoot 'community'
New-Item -ItemType Directory -Force -Path (Join-Path $communityPayload 'scripts\lib'), (Join-Path $communityPayload 'assets'), (Join-Path $communityPayload 'hermes-plugin'), (Join-Path $communityPayload 'node_modules') | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'scripts\community-generate.mjs') -Destination (Join-Path $communityPayload 'scripts\community-generate.mjs')
Copy-Item -LiteralPath (Join-Path $root 'scripts\community-provision.mjs') -Destination (Join-Path $communityPayload 'scripts\community-provision.mjs')
Copy-Item -LiteralPath (Join-Path $root 'scripts\lib\community') -Destination (Join-Path $communityPayload 'scripts\lib\community') -Recurse
Copy-Item -LiteralPath (Join-Path $root 'assets\community-skills') -Destination (Join-Path $communityPayload 'assets\community-skills') -Recurse
Copy-Item -LiteralPath (Join-Path $root 'hermes-plugin\community-archive') -Destination (Join-Path $communityPayload 'hermes-plugin\community-archive') -Recurse
Copy-Item -LiteralPath (Join-Path $root 'node_modules\js-yaml') -Destination (Join-Path $communityPayload 'node_modules\js-yaml') -Recurse
Copy-Item -LiteralPath (Join-Path $root 'node_modules\argparse') -Destination (Join-Path $communityPayload 'node_modules\argparse') -Recurse

$result = $null
try {
  & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File (Join-Path $root 'installer\bootstrap.ps1') `
    -PayloadRoot $payloadRoot `
    -HermesHome $hermesHome `
    -SkipCompanionInstall `
    -SkipGatewaySetup `
    -NoLaunch
  if ($LASTEXITCODE -ne 0) {
    throw "Clean Hermes bootstrap exited with code $LASTEXITCODE."
  }

  $hermesExe = Join-Path $hermesHome 'hermes-agent\venv\Scripts\hermes.exe'
  $plugin = Join-Path $hermesHome 'desktop-plugins\business-shell\plugin.js'
  $skill = Join-Path $hermesHome 'skills\productivity\business-bootstrap\SKILL.md'
  $receipt = Join-Path $hermesHome 'desktop-plugins\business-shell\install-receipt.json'
  $policyDir = Join-Path $hermesHome 'plugins\business-whatsapp-policy'
  $policyInit = Join-Path $policyDir '__init__.py'
  $backendApi = Join-Path $hermesHome 'plugins\business-shell\dashboard\plugin_api.py'
  $backendManifest = Join-Path $hermesHome 'plugins\business-shell\dashboard\manifest.json'
  # The plugin, skill, policy AND companion backend now install as one
  # transactional unit with a single completion receipt at the plugin directory.
  foreach ($required in @($hermesExe, $plugin, $skill, $receipt, $policyInit, $backendApi, $backendManifest)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
      throw "Clean bootstrap did not create required file: $required"
    }
  }
  # The dashboard-only backend is enabled via the config.yaml allow-list the mount
  # gate reads (it is not agent-discoverable, so it never appears in plugins list).
  $configText = Get-Content -Raw -LiteralPath (Join-Path $hermesHome 'config.yaml')
  if ($configText -notmatch 'business-shell') {
    throw "Clean bootstrap did not enable business-shell in config.yaml.`n$configText"
  }

  $enabledPlugins = (& $hermesExe plugins list --plain --no-bundled 2>&1 | Out-String)
  if ($enabledPlugins -notmatch 'business-whatsapp-policy') {
    throw "Clean bootstrap did not register the WhatsApp reply-policy plugin.`n$enabledPlugins"
  }
  $versionOutput = (& $hermesExe --version 2>&1 | Out-String).Trim()
  if ($versionOutput -notmatch '0\.19\.\d+') {
    throw "Clean bootstrap installed an untested Hermes version: $versionOutput"
  }
  $installReceipt = Get-Content -Raw -LiteralPath $receipt | ConvertFrom-Json
  if (
    $installReceipt.pluginSha256 -ne (Get-FileHash -Algorithm SHA256 -LiteralPath $plugin).Hash -or
    $installReceipt.bootstrapSkillSha256 -ne (Get-FileHash -Algorithm SHA256 -LiteralPath $skill).Hash
  ) {
    throw 'Clean bootstrap receipt hashes do not match the installed payload.'
  }

  $result = [pscustomobject]@{
    ok = $true
    isolatedHermesHome = $hermesHome
    version = $versionOutput
    plugin = $true
    bootstrapSkill = $true
    receiptVerified = $true
    cleaned = $false
  }
}
finally {
  if (-not $Keep -and (Test-Path -LiteralPath $testRoot)) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}

if ($result) {
  $result.cleaned = -not (Test-Path -LiteralPath $testRoot)
  $result | ConvertTo-Json
}
