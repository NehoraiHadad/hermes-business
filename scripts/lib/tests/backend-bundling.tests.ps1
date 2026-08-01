# backend-bundling.tests.ps1 — drift guard proving the READ-ONLY companion
# backend is actually BUNDLED and WIRED into every install door, offline. A file
# that installs at runtime but is never packaged only fails on a customer's clean
# machine, so this suite pins: (a) the NSI File-bundles the dashboard payload,
# the BackendEnable module and its enable_plugin.py helper; (b) bootstrap.ps1
# loads BackendEnable BEFORE BusinessInstall; (c) BusinessInstall installs the
# dashboard transactionally and enables business-shell; (d) package.json ships the
# dashboard under extraResources for the packaged Electron staging path.
# Dot-sourced by scripts/test-bootstrap-lib.ps1; uses its shared harness.

# The complete companion backend runtime payload — the manifest and the mounted,
# self-contained api entrypoint. The business-context skill is persisted through the
# official Hermes Skills API, so no custom write-engine modules ship.
# Kept in lockstep with electron/paths.cjs DESKTOP_BACKEND_FILES / Get-DashboardBackendFiles.
$script:CompanionBackendPayloadFiles = @(
  'manifest.json',
  'plugin_api.py'
)

function Invoke-BackendBundlingTests {
  param([Parameter(Mandatory)][string]$Root)
  Write-Host 'Companion backend bundling drift:'

  $nsi = Get-Content -Raw -LiteralPath (Join-Path $Root 'installer\business-bootstrap.nsi')
  $boot = Get-Content -Raw -LiteralPath (Join-Path $Root 'installer\bootstrap.ps1')
  $business = Get-Content -Raw -LiteralPath (Join-Path $Root 'installer\lib\BusinessInstall.ps1')
  $pkg = Get-Content -Raw -LiteralPath (Join-Path $Root 'package.json') | ConvertFrom-Json

  Test-Case 'NSI File-bundles the full dashboard payload + BackendEnable + enable_plugin.py' {
    foreach ($name in $script:CompanionBackendPayloadFiles) {
      Assert-True ($nsi -match [regex]::Escape("dashboard\$name")) "$name not bundled in the NSI"
    }
    Assert-True ($nsi -match [regex]::Escape('File "lib\BackendEnable.ps1"')) 'BackendEnable.ps1 not File-bundled'
    Assert-True ($nsi -match [regex]::Escape('File "lib\enable_plugin.py"')) 'enable_plugin.py not File-bundled'
  }

  Test-Case 'the bundled dashboard files exist on disk' {
    foreach ($name in $script:CompanionBackendPayloadFiles) {
      Assert-True (Test-Path -LiteralPath (Join-Path $Root "hermes-plugin\business-shell\dashboard\$name") -PathType Leaf) "missing source: $name"
    }
  }

  Test-Case 'bootstrap.ps1 loads BackendEnable before BusinessInstall' {
    Assert-True ($boot -match "'BackendEnable.ps1'") 'bootstrap does not load BackendEnable.ps1'
    $iBackend = $boot.IndexOf('BackendEnable.ps1')
    $iBusiness = $boot.IndexOf('BusinessInstall.ps1')
    Assert-True ($iBackend -ge 0 -and $iBusiness -gt $iBackend) 'BackendEnable is not loaded before BusinessInstall'
  }

  Test-Case 'BusinessInstall installs the dashboard transactionally and enables the backend' {
    Assert-True ($business -match 'Get-DashboardPayloadFiles') 'BusinessInstall does not add the dashboard files to the transaction'
    Assert-True ($business -match 'Enable-DashboardPluginInConfig') 'BusinessInstall does not enable the backend in config'
    Assert-True ($business -match 'Assert-BackendHealthy') 'BusinessInstall does not health-check the backend'
    Assert-True ($business -match 'Restore-HermesConfig') 'BusinessInstall does not roll back the config enablement on failure'
  }

  Test-Case 'package.json extraResources ships the dashboard for packaged Electron staging' {
    $entry = @($pkg.build.extraResources | Where-Object { $_.to -eq 'business-bootstrap/dashboard' })
    Assert-True ($entry.Count -eq 1) 'no business-bootstrap/dashboard extraResources entry'
    Assert-True ($entry[0].from -eq 'hermes-plugin/business-shell/dashboard') 'dashboard extraResources points at the wrong source'
    foreach ($name in $script:CompanionBackendPayloadFiles) {
      Assert-True ($entry[0].filter -contains $name) "dashboard extraResources does not ship $name"
    }
  }
}
