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

$policyPayload = Join-Path $payloadRoot 'whatsapp-policy'
New-Item -ItemType Directory -Force -Path $policyPayload | Out-Null
foreach ($policyFile in @('__init__.py', 'policy.py', 'ingest.py', 'contract.py', 'surface.py', 'guards.py', 'transport.py', 'registry.py', 'guard_core.py', 'surface_core.py', 'dispatch.py', 'telegram_policy.py', 'telegram_contract.py', 'telegram_surface.py', 'telegram_transport.py', 'telegram_registry.py', 'plugin.yaml')) {
  Copy-Item -LiteralPath (Join-Path $root "hermes-plugin\business-whatsapp-policy\$policyFile") `
    -Destination (Join-Path $policyPayload $policyFile)
}

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
  # The plugin, skill and policy now install as one transactional unit with a
  # single completion receipt at the business-shell plugin directory.
  foreach ($required in @($hermesExe, $plugin, $skill, $receipt, $policyInit)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
      throw "Clean bootstrap did not create required file: $required"
    }
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
