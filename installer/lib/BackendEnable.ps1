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
    'plugin_api.py',
    'makom_bridge.py',
    'makom/__init__.py',
    'makom/api.py',
    'makom/contract.py',
    'makom/source.py',
    'makom/store.py',
    'makom/bridge.py',
    'makom/SKILL.md'
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
  # PM owns selection. Never guess a generation or adopt an ambient Python.
  param([Parameter(Mandatory)][string]$HermesHome)
  $engine = Join-Path $HermesHome 'hermes-agent'
  if (Test-Path -LiteralPath (Join-Path $engine 'pm\environments.py')) {
    $command = Find-Hermes -HermesHome $HermesHome -HermesHomeWasExplicit:$true
    if (-not $command) { throw 'The official Hermes launcher is missing.' }
    $previousHome = $env:HERMES_HOME
    try {
      $env:HERMES_HOME = $HermesHome
      $runtime = (& $command --print-runtime-command | Out-String).Trim() | ConvertFrom-Json
      if ($LASTEXITCODE -ne 0 -or -not $runtime[0]) { throw 'Cannot resolve the native Hermes runtime.' }
      $code = 'import sys; from pathlib import Path; sys.path.insert(0,sys.argv[1]); from pm.environments import project_python; print(project_python(Path(sys.argv[1])))'
      $selected = (& $runtime[0] -I -c $code $engine | Out-String).Trim()
      if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $selected -PathType Leaf)) { throw 'The native Hermes dependency environment is incomplete.' }
      return $selected
    } finally { $env:HERMES_HOME = $previousHome }
  }
  # Active pre-PM installs retain their own interpreter until an official update.
  $legacy = Join-Path $engine 'venv\Scripts\python.exe'
  if (Test-Path -LiteralPath $legacy -PathType Leaf) { return $legacy }
  # Pre-PM bootstrap also supported an externally owned Python. Native PM
  # installations above never take this fallback, including broken selections.
  foreach ($name in @('python.exe', 'python', 'py')) {
    $external = Get-Command $name -ErrorAction SilentlyContinue
    if ($external) { return $external.Source }
  }
  throw 'No native Hermes interpreter is available. Repair the official installation first.'
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
  $engineArgs = @()
  $engine = Join-Path $HermesHome 'hermes-agent'
  if (Test-Path -LiteralPath (Join-Path $engine 'pm\environments.py')) { $engineArgs = @('--engine-root', $engine) }
  $configPath = Join-Path $HermesHome 'config.yaml'
  $output = (& $python $script @engineArgs $configPath $PluginId 2>&1 | Out-String).Trim()
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
  $engineArgs = @()
  $engine = Join-Path $HermesHome 'hermes-agent'
  if (Test-Path -LiteralPath (Join-Path $engine 'pm\environments.py')) { $engineArgs = @('--engine-root', $engine) }
  $configPath = Join-Path $HermesHome 'config.yaml'
  & $python $script @engineArgs '--check' $configPath $PluginId 2>&1 | Out-Null
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
  # Explicit UTF-8 (Read-Utf8File): the manifest may carry non-ASCII strings and
  # must parse identically under Windows PowerShell 5.1 (ANSI default) and 7.
  $manifest = Read-Utf8File -Path (Join-Path $targetDir 'manifest.json') | ConvertFrom-Json
  if ([string]::IsNullOrWhiteSpace([string]$manifest.api)) {
    throw 'Companion backend health check failed: manifest.json does not declare an api entrypoint.'
  }
  if (-not (Test-DashboardPluginEnabled -HermesHome $HermesHome -PluginId $PluginId)) {
    throw "Companion backend health check failed: '$PluginId' is not an enabled plugin in config.yaml."
  }
  Write-Step 'Companion backend health check passed (files present, manifest declares api, config enabled).'
}
