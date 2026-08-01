const { app } = require('electron')
const { findHermes, getHermesVersion } = require('./paths.cjs')
const { reapProcessTree } = require('./process-util.cjs')
const { authHeaders } = require('./hermes-auth.cjs')
const {
  SESSION_TOKEN,
  getSessionToken,
  baseUrl,
  wsUrl,
  getRuntimeState,
  patchRuntimeState,
  getHermesProcess,
  setHermesProcess
} = require('./runtime-state.cjs')
const { refreshRuntimeInstalled, startHermes } = require('./runtime-launch.cjs')

// Owns the managed Hermes runtime's public surface: process lifecycle
// (stop/restart) and the authenticated REST proxy the renderer uses via IPC. The
// mutable state lives in runtime-state.cjs and the spawn/health launch path in
// runtime-launch.cjs; this facade re-exports the full API so consumers are
// unchanged.

async function stopHermes() {
  const proc = getHermesProcess()
  if (!proc) return
  setHermesProcess(null)
  reapProcessTree(proc)
  patchRuntimeState({ running: false, starting: false })
}

async function restartHermes() {
  await stopHermes()
  return startHermes()
}

async function hermesApi(endpoint, init = {}) {
  if (!getRuntimeState().running) await startHermes()
  if (!getRuntimeState().running) throw new Error(getRuntimeState().error || 'Hermes is not running')
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
  return Boolean(getHermesProcess())
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
