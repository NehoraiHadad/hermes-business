const { app } = require('electron')
const { spawn } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { rememberLog } = require('./logs.cjs')
const { findHermes, getHermesVersion } = require('./paths.cjs')
const { chooseRuntimePort, waitForHealth } = require('./runtime-network.cjs')
const { isVersionSupported, HERMES_COMPAT_RANGE } = require('./hermes-compat.cjs')
const { writeRootEnv } = require('./partner-settings.cjs')
const { reapProcessTree } = require('./process-util.cjs')
const { authHeaders, wsUrlWithToken } = require('./hermes-auth.cjs')

// Owns the managed Hermes runtime: a private session token, a dynamically chosen
// loopback port, process lifecycle, health polling, and the authenticated REST
// proxy the renderer uses via IPC.

const PREFERRED_PORT = 9119
const SESSION_TOKEN = randomBytes(32).toString('base64url')

let runtimePort = PREFERRED_PORT
const baseUrl = () => `http://127.0.0.1:${runtimePort}`
// Loopback WS auth is the `?token=` query param ONLY — the single-use `?ticket=`
// path is gated-mode-only and never checked on a loopback bind. See hermes-auth.
const wsUrl = () => wsUrlWithToken(`ws://127.0.0.1:${runtimePort}/api/ws`, SESSION_TOKEN)

let hermesProcess = null
let runtimeState = {
  installed: false,
  running: false,
  starting: false,
  mode: 'live',
  version: null,
  compatible: true,
  compatRange: HERMES_COMPAT_RANGE,
  error: null,
  wsUrl: wsUrl()
}

const getRuntimeState = () => runtimeState
const getSessionToken = () => SESSION_TOKEN

function refreshRuntimeInstalled() {
  const command = findHermes()
  const version = getHermesVersion(command)
  // Startup compatibility surfacing: an unsupported runtime is flagged (never
  // auto-updated). The version still runs; the update flow enforces the range.
  runtimeState = {
    ...runtimeState,
    installed: Boolean(command),
    version,
    compatible: command ? isVersionSupported(version) : true
  }
  return runtimeState
}

async function startHermes() {
  if (runtimeState.running) return runtimeState
  if (runtimeState.starting) {
    const deadline = Date.now() + 50_000
    while (runtimeState.starting && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return runtimeState
  }
  const command = findHermes()
  runtimeState = {
    ...runtimeState,
    installed: Boolean(command),
    version: getHermesVersion(command),
    starting: Boolean(command),
    error: null
  }
  if (!command) return runtimeState

  runtimePort = await chooseRuntimePort(PREFERRED_PORT)
  runtimeState = { ...runtimeState, wsUrl: wsUrl() }
  const env = {
    ...process.env,
    HERMES_DASHBOARD_SESSION_TOKEN: SESSION_TOKEN,
    HERMES_DESKTOP: '1'
  }
  // The ONLY env the sandbox injects: the write-safe root for the local 'guard'
  // tier. It gates write_file/patch/delete/move (not reads/terminal). Absent for
  // the 'off' and 'docker' tiers, so a stale value never lingers across changes.
  const safeRoot = (() => {
    try {
      return writeRootEnv()
    } catch {
      return null
    }
  })()
  if (safeRoot) env.HERMES_WRITE_SAFE_ROOT = safeRoot
  // `hermes serve` is headless by definition. Current Hermes versions do not
  // expose a `--no-open` flag, so passing it makes the managed runtime exit
  // before the health check can ever succeed.
  const processInstance = spawn(command, ['serve', '--host', '127.0.0.1', '--port', String(runtimePort)], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  hermesProcess = processInstance
  processInstance.stdout.on('data', chunk => rememberLog(chunk))
  processInstance.stderr.on('data', chunk => rememberLog(chunk))
  processInstance.on('exit', code => {
    rememberLog(`Hermes exited (${code ?? 'unknown'})`)
    if (hermesProcess !== processInstance) return
    hermesProcess = null
    runtimeState = { ...runtimeState, running: false, starting: false }
  })

  try {
    await waitForHealth({ baseUrl: baseUrl(), token: SESSION_TOKEN })
    runtimeState = { ...runtimeState, running: true, starting: false }
  } catch (error) {
    // Health never came up. Reap the process we just spawned so it cannot
    // linger as an orphan holding the loopback port (a re-launch would then
    // fail to bind, or silently pick a second port and leak the first). Clear
    // our handle FIRST so the async 'exit' guard is a no-op and cannot race
    // this state write and flip `running` back.
    if (hermesProcess === processInstance) hermesProcess = null
    reapProcessTree(processInstance)
    rememberLog(`Hermes health check failed; reaped runtime pid ${processInstance.pid}`)
    runtimeState = { ...runtimeState, running: false, starting: false, error: String(error.message || error) }
  }
  return runtimeState
}

async function stopHermes() {
  if (!hermesProcess) return
  const proc = hermesProcess
  hermesProcess = null
  reapProcessTree(proc)
  runtimeState = { ...runtimeState, running: false, starting: false }
}

async function restartHermes() {
  await stopHermes()
  return startHermes()
}

async function hermesApi(endpoint, init = {}) {
  if (!runtimeState.running) await startHermes()
  if (!runtimeState.running) throw new Error(runtimeState.error || 'Hermes is not running')
  const headers = authHeaders(SESSION_TOKEN, {
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers || {})
  })
  const response = await fetch(`${baseUrl()}${endpoint}`, {
    method: init.method || 'GET',
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || `Hermes returned HTTP ${response.status}`)
  }
  return payload
}

async function getVersions() {
  const command = findHermes()
  return {
    shell: app.getVersion(),
    hermes: getHermesVersion(command) || 'לא מותקן',
    electron: process.versions.electron,
    node: process.versions.node
  }
}

function hasRunningProcess() {
  return Boolean(hermesProcess)
}

module.exports = {
  SESSION_TOKEN,
  getSessionToken,
  baseUrl,
  wsUrl,
  getRuntimeState,
  refreshRuntimeInstalled,
  startHermes,
  stopHermes,
  restartHermes,
  hermesApi,
  getVersions,
  hasRunningProcess
}
