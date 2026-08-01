const path = require('node:path')

// The runtime-lifecycle helpers that bracket the self-update transaction: bring
// the official Hermes surfaces DOWN before mutating the checkout, and back UP
// (with BOTH health gates) after. Both are pure orchestration over injected
// collaborators — the transaction itself lives in hermes-update-flow.cjs.

// Closes ONLY the Hermes Desktop processes whose executable lives under the
// install root being replaced (never unrelated apps). Runs under -NoProfile
// -NonInteractive; HERMES_UPDATE_ROOT is passed in the environment.
const closeDesktopScript = String.raw`
$root = [IO.Path]::GetFullPath($env:HERMES_UPDATE_ROOT).TrimEnd('\') + '\'
$targets = @(Get-CimInstance Win32_Process | Where-Object {
  $exe = [string]$_.ExecutablePath
  $cmd = [string]$_.CommandLine
  $inside = $exe.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)
  $desktop = $cmd -match '(?i)(^|\s)desktop(\s|$)' -or $exe -match '(?i)\\apps\\desktop\\release\\'
  $inside -and $desktop
})
foreach ($target in ($targets | Sort-Object ProcessId -Descending)) {
  Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 800
Write-Output $targets.Count
`

async function stopOfficialSurfaces(command, deps) {
  const { stopHermes, runCaptured, rememberLog, platform = process.platform } = deps
  await stopHermes()
  await runCaptured(command, ['gateway', 'stop', '--all'], 90_000).catch(error => {
    rememberLog(`Gateway stop before update returned: ${error.message || error}`)
  })
  if (platform !== 'win32') return
  // The executable being replaced is under this install root; close only the
  // Hermes Desktop processes running from inside it (never unrelated apps).
  const root = path.resolve(command, '..', '..', '..')
  await runCaptured(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', closeDesktopScript],
    45_000,
    { HERMES_UPDATE_ROOT: root }
  )
}

// Bring the runtime back up and require BOTH health surfaces: the foreground
// `hermes serve` (process running + /api/health ok) AND the background gateway
// deep PROCESS/lifecycle liveness (`gateway status --deep`; not a channel/cron
// probe). Throws if either fails, so no caller can ever report restored/running
// unless both actually pass.
async function recoverRuntime(command, deps) {
  const { ensureGatewayBackground, startHermes, hermesApi, assertGatewayDeepHealthy } = deps
  await ensureGatewayBackground(command)
  const runtime = await startHermes()
  if (!runtime.running) throw new Error(runtime.error || 'Hermes did not restart after update')
  const health = await hermesApi('/api/health')
  if (!health?.ok) throw new Error('Hermes failed its post-update health check')
  await assertGatewayDeepHealthy(command)
  return { runtime, health }
}

module.exports = { stopOfficialSurfaces, recoverRuntime, closeDesktopScript }
