const { spawn } = require('node:child_process')
const { rememberLog } = require('./logs.cjs')
const { findHermes, getHermesVersion } = require('./paths.cjs')
const { chooseRuntimePort, waitForHealth } = require('./runtime-network.cjs')
const { isVersionSupported } = require('./hermes-compat.cjs')
const { reapProcessTree } = require('./process-util.cjs')
const { buildChildEnv } = require('./runtime-env.cjs')
const { buildQaDiagnostics } = require('./runtime-qa.cjs')
const { getRuntimeMode } = require('./runtime-mode.cjs')
const {
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
  const runtimeConfig = getRuntimeMode()
  const command = findHermes()
  const version = getHermesVersion(command)
  // Startup compatibility surfacing: an unsupported runtime is flagged (never
  // auto-updated). The version still runs; the update flow enforces the range.
  return patchRuntimeState({
    installed: Boolean(command),
    version,
    mode: runtimeConfig.mode,
    isolated: runtimeConfig.isolated,
    hermesHome: runtimeConfig.hermesHome,
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
  // One process-owned mode contract chooses home, binary, namespace and port.
  // Invalid dev/QA requests fail closed instead of falling back to production.
  let runtimeConfig
  try {
    runtimeConfig = getRuntimeMode()
  } catch (error) {
    return patchRuntimeState({
      starting: false,
      running: false,
      error: `Runtime mode rejected: ${error.message || error}`
    })
  }

  const command = findHermes()
  patchRuntimeState({
    installed: Boolean(command),
    version: getHermesVersion(command),
    starting: Boolean(command),
    mode: runtimeConfig.mode,
    isolated: runtimeConfig.isolated,
    hermesHome: runtimeConfig.hermesHome,
    qa: runtimeConfig.mode === 'qa-isolated' ? buildQaDiagnostics() : null,
    error: null
  })
  if (!command) return getRuntimeState()

  const host = runtimeConfig.host
  let port
  try {
    port = await chooseRuntimePort(runtimeConfig.preferredPort, runtimeConfig.portRange)
  } catch (error) {
    return patchRuntimeState({
      starting: false,
      running: false,
      error: runtimeConfig.isolated
        ? `Isolated ${runtimeConfig.mode} port ${runtimeConfig.preferredPort} is unavailable`
        : String(error.message || error)
    })
  }
  setRuntimePort(port)
  patchRuntimeState({ wsUrl: wsUrl() })

  const env = buildChildEnv({ sessionToken: SESSION_TOKEN, runtimeConfig })
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
