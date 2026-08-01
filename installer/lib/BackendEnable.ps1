# BackendEnable.ps1 — install + enable the companion backend plugin (the mounted,
# self-contained read-only dashboard/plugin_api.py) as part of the business payload
# TRANSACTION, and roll the config enablement back atomically on failure.
#
# The desktop plugin reaches this backend through its namespace-locked
# ctx.rest('/cron/jobs'); Hermes mounts it at /api/plugins/business-shell once the
# id is in config.yaml's plugins.enabled allow-list. A dashboard-only plugin is
# not agent-discoverable, so `hermes plugins enable` cannot resolve it — enabling
# the allow-list (via Hermes' own PyYAML, see enable_plugin.py) is the sanctioned
# mechanism, identical to the Electron/dev installers.
#
# Depends on: Logging.ps1 (Write-Step), Hashing.ps1 (Get-Sha256Hash).

# Runtime payload: the manifest and the mounted, self-contained api entrypoint. In
# lockstep with electron/paths.cjs DESKTOP_BACKEND_FILES. Test .py files are excluded.
function Get-DashboardBackendFiles {
  return @(
    'manifest.json',
    'plugin_api.py'
  )
}

function Test-DashboardPayloadPresent {
  param([Parameter(Mandatory)][string]$PayloadRoot)
  $dir = Join-Path $PayloadRoot 'dashboard'
  if (-not (Test-Path -LiteralPath $dir -PathType Container)) { return $false }
  foreach ($name in (Get-DashboardBackendFiles)) {
    if (-not (Test-Path -LiteralPath (Join-Path $dir $name) -PathType Leaf)) { return $false }
  }
  return $true
}

function Get-DashboardPayloadFiles {
  # Transaction file list: <PayloadRoot>\dashboard\<name> -> <HermesHome>\plugins\business-shell\dashboard\<name>.
  param(
    [Parameter(Mandatory)][string]$PayloadRoot,
    [Parameter(Mandatory)][string]$HermesHome
  )
  $sourceDir = Join-Path $PayloadRoot 'dashboard'
  $targetDir = Join-Path $HermesHome 'plugins\business-shell\dashboard'
  return @(Get-DashboardBackendFiles | ForEach-Object {
    @{ Source = (Join-Path $sourceDir $_); Target = (Join-Path $targetDir $_) }
  })
}

function Backup-HermesConfig {
  # Snapshot config.yaml so an activation/health failure restores it byte-for-byte.
  param([Parameter(Mandatory)][string]$HermesHome)
  $path = Join-Path $HermesHome 'config.yaml'
  $existed = Test-Path -LiteralPath $path -PathType Leaf
  $content = if ($existed) { [System.IO.File]::ReadAllBytes($path) } else { $null }
  return [pscustomobject]@{ Path = $path; Existed = $existed; Content = $content }
}

function Restore-HermesConfig {
  param([Parameter(Mandatory)][pscustomobject]$Backup)
  if ($Backup.Existed) {
    [System.IO.File]::WriteAllBytes($Backup.Path, $Backup.Content)
  }
  elseif (Test-Path -LiteralPath $Backup.Path -PathType Leaf) {
    Remove-Item -LiteralPath $Backup.Path -Force
  }
}

function Resolve-PythonForConfig {
  # Prefer the Hermes venv Python (guaranteed to ship PyYAML); fall back to a
  # Python on PATH. Fail closed if none is found so the caller can roll back.
  param([Parameter(Mandatory)][string]$HermesHome)
  $venv = Join-Path $HermesHome 'hermes-agent\venv\Scripts\python.exe'
  if (Test-Path -LiteralPath $venv -PathType Leaf) { return $venv }
  foreach ($name in @('python.exe', 'python', 'py')) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
  }
  throw 'No Python interpreter is available to enable the companion backend in config.yaml.'
}

function Enable-DashboardPluginInConfig {
  # Idempotently add $PluginId to config.yaml plugins.enabled using Hermes' own
  # PyYAML (installer\lib\enable_plugin.py) — never hand-edited YAML.
  param(
    [Parameter(Mandatory)][string]$HermesHome,
    [Parameter(Mandatory)][string]$PluginId
  )
  $python = Resolve-PythonForConfig -HermesHome $HermesHome
  $script = Join-Path $PSScriptRoot 'enable_plugin.py'
  if (-not (Test-Path -LiteralPath $script -PathType Leaf)) {
    throw "The config-enable helper is missing: $script"
  }
  $configPath = Join-Path $HermesHome 'config.yaml'
  $output = (& $python $script $configPath $PluginId 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Enabling '$PluginId' in config.yaml failed: $output"
  }
  Write-Step "Companion backend '$PluginId' enabled in config.yaml ($output)."
}

function Test-DashboardPluginEnabled {
  # Semantic allow-list gate: run enable_plugin.py --check through the SAME
  # interpreter/PyYAML that wrote the config, so success means the id is an EXACT
  # element of plugins.enabled — the very thing Hermes' mount gate honours.
  # Returns $false (fails closed) for malformed YAML, a missing file/key, a
  # comment-only mention, a plugins.disabled-only entry, or a substring. The
  # helper's output is swallowed so no config text can surface in a log.
  param(
    [Parameter(Mandatory)][string]$HermesHome,
    [Parameter(Mandatory)][string]$PluginId
  )
  $python = Resolve-PythonForConfig -HermesHome $HermesHome
  $script = Join-Path $PSScriptRoot 'enable_plugin.py'
  if (-not (Test-Path -LiteralPath $script -PathType Leaf)) {
    throw "The config-enable helper is missing: $script"
  }
  $configPath = Join-Path $HermesHome 'config.yaml'
  & $python $script '--check' $configPath $PluginId 2>&1 | Out-Null
  return ($LASTEXITCODE -eq 0)
}

function Assert-BackendHealthy {
  # Offline health/integrity gate run inside the transaction's Activate step: the
  # dashboard files must exist at the target, the manifest must declare its api,
  # and the config allow-list must now carry the plugin id. Throwing here rolls
  # back BOTH the desktop-plugin files and the config enablement.
  param(
    [Parameter(Mandatory)][string]$HermesHome,
    [Parameter(Mandatory)][string]$PluginId
  )
  $targetDir = Join-Path $HermesHome 'plugins\business-shell\dashboard'
  foreach ($name in (Get-DashboardBackendFiles)) {
    if (-not (Test-Path -LiteralPath (Join-Path $targetDir $name) -PathType Leaf)) {
      throw "Companion backend health check failed: missing installed file $name."
    }
  }
  $manifest = Get-Content -Raw -LiteralPath (Join-Path $targetDir 'manifest.json') | ConvertFrom-Json
  if ([string]::IsNullOrWhiteSpace([string]$manifest.api)) {
    throw 'Companion backend health check failed: manifest.json does not declare an api entrypoint.'
  }
  if (-not (Test-DashboardPluginEnabled -HermesHome $HermesHome -PluginId $PluginId)) {
    throw "Companion backend health check failed: '$PluginId' is not an enabled plugin in config.yaml."
  }
  Write-Step 'Companion backend health check passed (files present, manifest declares api, config enabled).'
}
