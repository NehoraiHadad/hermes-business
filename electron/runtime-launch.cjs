const { spawn } = require('node:child_process')
const { rememberLog } = require('./logs.cjs')
const { findHermes, getHermesVersion } = require('./paths.cjs')
const { chooseRuntimePort, waitForHealth } = require('./runtime-network.cjs')
const { isVersionSupported } = require('./hermes-compat.cjs')
const { reapProcessTree } = require('./process-util.cjs')
const { getQaRuntimeOverride } = require('./qa-runtime.cjs')
const { buildChildEnv } = require('./runtime-env.cjs')
const { buildQaDiagnostics } = require('./runtime-qa.cjs')
const {
  PREFERRED_PORT,
  SESSION_TOKEN,
  baseUrl,
  wsUrl,
  getRuntimeState,
  patchRuntimeState,
  setRuntimePort,
  getHermesProcess,
  setHermesProcess
} = require('./runtime-state.cjs')

// The runtime LAUNCH concern: refresh installed/compat status and spawn the
// managed Hermes gateway (fail-closed QA isolation, port binding, health polling
// and orphan reaping). State lives in runtime-state.cjs; the authenticated proxy
// and lifecycle facade live in runtime.cjs.

function refreshRuntimeInstalled() {
  const command = findHermes()
  const version = getHermesVersion(command)
  // Startup compatibility surfacing: an unsupported runtime is flagged (never
  // auto-updated). The version still runs; the update flow enforces the range.
  return patchRuntimeState({
    installed: Boolean(command),
    version,
    compatible: command ? isVersionSupported(version) : true
  })
}

async function startHermes() {
  const state = getRuntimeState()
  if (state.running) return state
  if (state.starting) {
    const deadline = Date.now() + 50_000
    while (getRuntimeState().starting && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return getRuntimeState()
  }
  // Automated-QA isolation contract (main-process only, fail-closed). Absent in
  // production: `override.enabled` is false and everything below is the exact
  // one-live-home behavior. When present, the runtime binds an isolated loopback
  // port and points the child gateway's HERMES_HOME at a throwaway temp dir.
  let override
  try {
    override = getQaRuntimeOverride()
  } catch (error) {
    // A QA run was requested but the override is invalid. NEVER fall back to the
    // live profile — refuse to start and surface the reason.
    return patchRuntimeState({
      starting: false,
      running: false,
      error: `QA runtime override rejected: ${error.message || error}`
    })
  }

  const command = findHermes()
  patchRuntimeState({
    installed: Boolean(command),
    version: getHermesVersion(command),
    starting: Boolean(command),
    mode: override.enabled ? 'qa-isolated' : 'live',
    hermesHome: override.enabled ? override.hermesHome : null,
    qa: override.enabled ? buildQaDiagnostics() : null,
    error: null
  })
  if (!command) return getRuntimeState()

  const host = override.enabled ? override.host : '127.0.0.1'
  let port
  try {
    // QA: bind the EXACT isolated port (range 1 = no drift), so the harness can
    // prove which loopback port was used and that it is freed afterwards.
    port = override.enabled
      ? await chooseRuntimePort(override.port, 1)
      : await chooseRuntimePort(PREFERRED_PORT)
  } catch (error) {
    return patchRuntimeState({
      starting: false,
      running: false,
      error: override.enabled
        ? `Isolated QA port ${override.port} is unavailable`
        : String(error.message || error)
    })
  }
  setRuntimePort(port)
  patchRuntimeState({ wsUrl: wsUrl() })

  const env = buildChildEnv({ sessionToken: SESSION_TOKEN, override })
  // `hermes serve` is headless by definition. Current Hermes versions do not
  // expose a `--no-open` flag, so passing it makes the managed runtime exit
  // before the health check can ever succeed.
  const processInstance = spawn(command, ['serve', '--host', host, '--port', String(port)], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  setHermesProcess(processInstance)
  processInstance.stdout.on('data', chunk => rememberLog(chunk))
  processInstance.stderr.on('data', chunk => rememberLog(chunk))
  processInstance.on('exit', code => {
    rememberLog(`Hermes exited (${code ?? 'unknown'})`)
    if (getHermesProcess() !== processInstance) return
    setHermesProcess(null)
    patchRuntimeState({ running: false, starting: false })
  })

  try {
    await waitForHealth({ baseUrl: baseUrl(), token: SESSION_TOKEN })
    patchRuntimeState({ running: true, starting: false })
  } catch (error) {
    // Health never came up. Reap the process we just spawned so it cannot
    // linger as an orphan holding the loopback port (a re-launch would then
    // fail to bind, or silently pick a second port and leak the first). Clear
    // our handle FIRST so the async 'exit' guard is a no-op and cannot race
    // this state write and flip `running` back.
    if (getHermesProcess() === processInstance) setHermesProcess(null)
    reapProcessTree(processInstance)
    rememberLog(`Hermes health check failed; reaped runtime pid ${processInstance.pid}`)
    patchRuntimeState({ running: false, starting: false, error: String(error.message || error) })
  }
  return getRuntimeState()
}

module.exports = { refreshRuntimeInstalled, startHermes }
