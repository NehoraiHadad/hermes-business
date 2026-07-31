const { app } = require('electron')
const { spawn, spawnSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const net = require('node:net')
const { rememberLog } = require('./logs.cjs')
const { findHermes, getHermesVersion } = require('./paths.cjs')

// Owns the managed Hermes runtime: a private session token, a dynamically chosen
// loopback port, process lifecycle, health polling, and the authenticated REST
// proxy the renderer uses via IPC.

const PREFERRED_PORT = 9119
const SESSION_TOKEN = randomBytes(32).toString('base64url')

let runtimePort = PREFERRED_PORT
const baseUrl = () => `http://127.0.0.1:${runtimePort}`
const wsUrl = () => `ws://127.0.0.1:${runtimePort}/api/ws?token=${encodeURIComponent(SESSION_TOKEN)}`

let hermesProcess = null
let runtimeState = {
  installed: false,
  running: false,
  starting: false,
  mode: 'live',
  version: null,
  error: null,
  wsUrl: wsUrl()
}

const getRuntimeState = () => runtimeState
const getSessionToken = () => SESSION_TOKEN

function refreshRuntimeInstalled() {
  const command = findHermes()
  runtimeState = { ...runtimeState, installed: Boolean(command), version: getHermesVersion(command) }
  return runtimeState
}

async function waitForHealth(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl()}/api/health`, {
        headers: { Authorization: `Bearer ${SESSION_TOKEN}` }
      })
      if (response.ok) return await response.json()
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 600))
  }
  throw lastError || new Error('Hermes did not become ready')
}

function isPortAvailable(port) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })
}

async function chooseRuntimePort() {
  for (let candidate = PREFERRED_PORT; candidate < PREFERRED_PORT + 80; candidate += 1) {
    if (await isPortAvailable(candidate)) return candidate
  }
  throw new Error('No private local port is available for the Hermes companion')
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

  runtimePort = await chooseRuntimePort()
  runtimeState = { ...runtimeState, wsUrl: wsUrl() }
  const env = {
    ...process.env,
    HERMES_DASHBOARD_SESSION_TOKEN: SESSION_TOKEN,
    HERMES_DESKTOP: '1'
  }
  // `hermes serve` is headless by definition. Current Hermes versions do not
  // expose a `--no-open` flag, so passing it makes the managed runtime exit
  // before the health check can ever succeed.
  hermesProcess = spawn(command, ['serve', '--host', '127.0.0.1', '--port', String(runtimePort)], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  hermesProcess.stdout.on('data', chunk => rememberLog(chunk))
  hermesProcess.stderr.on('data', chunk => rememberLog(chunk))
  hermesProcess.on('exit', code => {
    rememberLog(`Hermes exited (${code ?? 'unknown'})`)
    hermesProcess = null
    runtimeState = { ...runtimeState, running: false, starting: false }
  })

  try {
    await waitForHealth()
    runtimeState = { ...runtimeState, running: true, starting: false }
  } catch (error) {
    runtimeState = { ...runtimeState, running: false, starting: false, error: String(error.message || error) }
  }
  return runtimeState
}

async function stopHermes() {
  if (!hermesProcess) return
  const proc = hermesProcess
  hermesProcess = null
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(proc.pid), '/t', '/f'], { windowsHide: true })
  } else {
    proc.kill('SIGTERM')
  }
  runtimeState = { ...runtimeState, running: false, starting: false }
}

async function restartHermes() {
  await stopHermes()
  return startHermes()
}

async function hermesApi(endpoint, init = {}) {
  if (!runtimeState.running) await startHermes()
  if (!runtimeState.running) throw new Error(runtimeState.error || 'Hermes is not running')
  const headers = {
    Authorization: `Bearer ${SESSION_TOKEN}`,
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers || {})
  }
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
