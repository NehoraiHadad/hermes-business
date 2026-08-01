# backend-enable.tests.ps1 — offline proof that the READ-ONLY companion backend
# (dashboard/manifest.json + plugin_api.py) installs + enables INSIDE the payload
# transaction, that an activation/health failure rolls BOTH the desktop-plugin files
# AND the config.yaml enablement back atomically, and that the health gate is
# SEMANTIC (exact plugins.enabled membership, fails closed). Dot-sourced by
# test-bootstrap-lib.ps1 (Test-Case/Assert-True harness); isolated temp homes, a
# Python on PATH with PyYAML — no real Hermes. Keep this suite <=150 lines.

function New-BackendPayload {
  param([Parameter(Mandatory)][string]$Directory, [string]$Api = 'plugin_api.py')
  $dash = Join-Path $Directory 'dashboard'
  New-Item -ItemType Directory -Force -Path $dash | Out-Null
  Set-Content -LiteralPath (Join-Path $Directory 'plugin.js') -Value "// plugin $([guid]::NewGuid())" -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $dash 'manifest.json') -Value ('{{"name":"business-shell","api":"{0}"}}' -f $Api) -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $dash 'plugin_api.py') -Value "# api $([guid]::NewGuid())" -Encoding UTF8
  return $Directory
}

function New-BackendActivate {
  # Mirrors installer/lib/BusinessInstall.ps1's activate for the backend: snapshot
  # config, enable, health-check, restore-on-failure. $Fail forces a health error.
  param([string]$HermesHome, [bool]$Fail)
  return {
    $configBackup = Backup-HermesConfig -HermesHome $HermesHome
    try {
      Enable-DashboardPluginInConfig -HermesHome $HermesHome -PluginId 'business-shell'
      if ($Fail) { throw 'simulated backend health failure' }
      Assert-BackendHealthy -HermesHome $HermesHome -PluginId 'business-shell'
    }
    catch { Restore-HermesConfig -Backup $configBackup; throw }
  }.GetNewClosure()
}

function New-HealthHome {
  # Valid dashboard files + an api-declaring manifest so only -Config is under test.
  param([string]$Root, [string]$Name, [object]$Config)
  $healthHome = Join-Path $Root $Name
  $dash = Join-Path $healthHome 'plugins\business-shell\dashboard'
  New-Item -ItemType Directory -Force -Path $dash | Out-Null
  Set-Content -LiteralPath (Join-Path $dash 'manifest.json') -Value '{"name":"business-shell","api":"plugin_api.py"}' -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $dash 'plugin_api.py') -Value '# api' -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $healthHome 'config.yaml') -Value $Config -Encoding UTF8
  return $healthHome
}

function Invoke-BackendEnableTests {
  param([Parameter(Mandatory)][string]$WorkRoot)
  Write-Host 'Companion backend enable + transaction:'

  Test-Case 'enable_plugin.py adds business-shell idempotently and preserves other keys' {
    $hermesHome = Join-Path $WorkRoot 'enable home'
    New-Item -ItemType Directory -Force -Path $hermesHome | Out-Null
    Set-Content -LiteralPath (Join-Path $hermesHome 'config.yaml') -Encoding UTF8 -Value @(
      'model: gpt-test', 'plugins:', '  enabled:', '  - business-whatsapp-policy')
    Enable-DashboardPluginInConfig -HermesHome $hermesHome -PluginId 'business-shell'
    Enable-DashboardPluginInConfig -HermesHome $hermesHome -PluginId 'business-shell'
    $text = Get-Content -Raw -LiteralPath (Join-Path $hermesHome 'config.yaml')
    Assert-True ($text -match 'business-shell') 'business-shell not enabled'
    Assert-True ($text -match 'business-whatsapp-policy') 'existing plugin dropped'
    Assert-True ($text -match 'model') 'unrelated config key dropped'
    $count = ([regex]::Matches($text, 'business-shell')).Count
    Assert-True ($count -eq 1) "business-shell enabled $count times (not idempotent)"
  }

  Test-Case 'transaction commits the dashboard payload and enables the backend' {
    $hermesHome = Join-Path $WorkRoot (-join ([int[]](0x05D1, 0x05D3, 0x05D9, 0x05E7, 0x20, 0x31) | ForEach-Object { [char]$_ }))
    New-Item -ItemType Directory -Force -Path $hermesHome | Out-Null
    $payload = New-BackendPayload -Directory (Join-Path $WorkRoot 'payload-ok')
    $files = @(@{ Source = (Join-Path $payload 'plugin.js'); Target = (Join-Path $hermesHome 'desktop-plugins\business-shell\plugin.js') })
    $files += Get-DashboardPayloadFiles -PayloadRoot $payload -HermesHome $hermesHome
    Invoke-PayloadTransaction -HermesHome $hermesHome -Label 'business-shell' -Files $files -BootstrapVersion '0.3.3' `
      -ReceiptTarget (Join-Path $hermesHome 'desktop-plugins\business-shell\install-receipt.json') `
      -Activate (New-BackendActivate -HermesHome $hermesHome -Fail $false) | Out-Null
    Assert-True (Test-Path -LiteralPath (Join-Path $hermesHome 'plugins\business-shell\dashboard\plugin_api.py') -PathType Leaf) 'plugin_api.py not committed'
    Assert-True (Test-Path -LiteralPath (Join-Path $hermesHome 'plugins\business-shell\dashboard\manifest.json') -PathType Leaf) 'manifest.json not committed'
    Assert-True ((Get-Content -Raw -LiteralPath (Join-Path $hermesHome 'config.yaml')) -match 'business-shell') 'backend not enabled in config'
  }

  Test-Case 'activation/health failure rolls back the dashboard files AND restores config' {
    $hermesHome = Join-Path $WorkRoot 'rollback backend home'
    New-Item -ItemType Directory -Force -Path (Join-Path $hermesHome 'desktop-plugins\business-shell') | Out-Null
    Set-Content -LiteralPath (Join-Path $hermesHome 'desktop-plugins\business-shell\plugin.js') -Value 'PREVIOUS' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $hermesHome 'config.yaml') -Encoding UTF8 -Value @('plugins:', '  enabled:', '  - business-whatsapp-policy')
    $configBefore = Get-Content -Raw -LiteralPath (Join-Path $hermesHome 'config.yaml')
    $payload = New-BackendPayload -Directory (Join-Path $WorkRoot 'payload-rb')
    $files = @(@{ Source = (Join-Path $payload 'plugin.js'); Target = (Join-Path $hermesHome 'desktop-plugins\business-shell\plugin.js') })
    $files += Get-DashboardPayloadFiles -PayloadRoot $payload -HermesHome $hermesHome
    $threw = $false
    try {
      Invoke-PayloadTransaction -HermesHome $hermesHome -Label 'business-shell' -Files $files -BootstrapVersion '0.3.3' `
        -ReceiptTarget (Join-Path $hermesHome 'desktop-plugins\business-shell\install-receipt.json') `
        -Activate (New-BackendActivate -HermesHome $hermesHome -Fail $true) | Out-Null
    }
    catch { $threw = $true }
    Assert-True $threw 'health failure did not raise'
    Assert-True ((Get-Content -Raw -LiteralPath (Join-Path $hermesHome 'desktop-plugins\business-shell\plugin.js')).Trim() -eq 'PREVIOUS') 'prior plugin not restored'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $hermesHome 'plugins\business-shell\dashboard\plugin_api.py'))) 'dashboard file survived rollback'
    Assert-True ((Get-Content -Raw -LiteralPath (Join-Path $hermesHome 'config.yaml')) -eq $configBefore) 'config enablement was not rolled back'
  }

  Test-Case 'upgrade from a prior install replaces the dashboard payload and stays enabled' {
    $hermesHome = Join-Path $WorkRoot 'upgrade home'
    New-Item -ItemType Directory -Force -Path (Join-Path $hermesHome 'plugins\business-shell\dashboard') | Out-Null
    Set-Content -LiteralPath (Join-Path $hermesHome 'plugins\business-shell\dashboard\plugin_api.py') -Value '# OLD-API' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $hermesHome 'config.yaml') -Encoding UTF8 -Value @('plugins:', '  enabled:', '  - business-shell')
    $payload = New-BackendPayload -Directory (Join-Path $WorkRoot 'payload-up')
    $files = @(@{ Source = (Join-Path $payload 'plugin.js'); Target = (Join-Path $hermesHome 'desktop-plugins\business-shell\plugin.js') })
    $files += Get-DashboardPayloadFiles -PayloadRoot $payload -HermesHome $hermesHome
    Invoke-PayloadTransaction -HermesHome $hermesHome -Label 'business-shell' -Files $files -BootstrapVersion '0.3.3' `
      -ReceiptTarget (Join-Path $hermesHome 'desktop-plugins\business-shell\install-receipt.json') `
      -Activate (New-BackendActivate -HermesHome $hermesHome -Fail $false) | Out-Null
    $newApi = Get-Content -Raw -LiteralPath (Join-Path $hermesHome 'plugins\business-shell\dashboard\plugin_api.py')
    Assert-True ($newApi -notmatch 'OLD-API') 'prior dashboard payload was not replaced on upgrade'
    Assert-True (([regex]::Matches((Get-Content -Raw -LiteralPath (Join-Path $hermesHome 'config.yaml')), 'business-shell')).Count -eq 1) 'upgrade duplicated the enable entry'
  }

  Test-Case 'Assert-BackendHealthy fails closed when the manifest declares no api' {
    $hermesHome = Join-Path $WorkRoot 'health home'
    $dash = Join-Path $hermesHome 'plugins\business-shell\dashboard'
    New-Item -ItemType Directory -Force -Path $dash | Out-Null
    Set-Content -LiteralPath (Join-Path $dash 'manifest.json') -Value '{"name":"business-shell"}' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $dash 'plugin_api.py') -Value '# api' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $hermesHome 'config.yaml') -Value 'plugins:' -Encoding UTF8
    $threw = $false
    try { Assert-BackendHealthy -HermesHome $hermesHome -PluginId 'business-shell' } catch { $threw = $true }
    Assert-True $threw 'a manifest without an api entrypoint passed the health gate'
  }

  # Semantic gate: each config mentions 'business-shell' in raw text (a regex gate would false-pass) but is never a live plugins.enabled element (disabled precedence blocks the 'disabled'/'both' shapes), so the PyYAML health check must throw.
  foreach ($case in @(
      @{ Name = 'comment';   Why = 'a commented-out id false-passed the gate';        Config = @('plugins:', '  enabled:', '  - business-whatsapp-policy', '# business-shell is intentionally NOT enabled') },
      @{ Name = 'scalar';    Why = 'an unrelated scalar containing the id false-passed'; Config = @('note: business-shell', 'plugins:', '  enabled:', '  - business-whatsapp-policy') },
      @{ Name = 'disabled';  Why = 'a plugins.disabled-only id false-passed the gate';   Config = @('plugins:', '  enabled: []', '  disabled:', '  - business-shell') },
      @{ Name = 'both';      Why = 'an id in BOTH enabled and disabled false-passed';     Config = @('plugins:', '  enabled:', '  - business-shell', '  disabled:', '  - business-shell') },
      @{ Name = 'substring'; Why = 'a superstring (substring match) false-passed the gate'; Config = @('plugins:', '  enabled:', '  - business-shell-extra') },
      @{ Name = 'malformed'; Why = 'malformed YAML did not fail closed';                 Config = @('plugins:', '  enabled: [business-shell', 'unbalanced: "') })) {
    Test-Case "health gate fails closed: $($case.Name)" {
      $hh = New-HealthHome -Root $WorkRoot -Name "health $($case.Name)" -Config $case.Config
      $threw = $false
      try { Assert-BackendHealthy -HermesHome $hh -PluginId 'business-shell' } catch { $threw = $true }
      Assert-True $threw $case.Why
    }.GetNewClosure()
  }

  Test-Case 'health gate passes when the id is an exact element of plugins.enabled' {
    $hh = New-HealthHome -Root $WorkRoot -Name 'health exact' -Config @(
      'plugins:', '  enabled:', '  - business-whatsapp-policy', '  - business-shell')
    Assert-BackendHealthy -HermesHome $hh -PluginId 'business-shell'  # non-throw == pass
  }
}
