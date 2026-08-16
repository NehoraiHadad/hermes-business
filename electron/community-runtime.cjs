const { randomBytes } = require('node:crypto')
const { spawn } = require('node:child_process')
const path = require('node:path')
const { authHeaders } = require('./hermes-auth.cjs')
const { rememberLog } = require('./logs.cjs')
const { reapProcessTree, runCaptured } = require('./process-util.cjs')
const { chooseRuntimePort, waitForHealth } = require('./runtime-network.cjs')
const { hermesHome } = require('./paths.cjs')
const {
  COMMUNITY_PREFERRED_PORT,
  COMMUNITY_PORT_RANGE,
  inspectCommunityInstall
} = require('./community-runtime-config.cjs')

function createCommunityRuntime(deps = {}) {
  const io = {
    inspect: inspectCommunityInstall,
    choosePort: chooseRuntimePort,
    waitForHealth,
    spawn,
    runCaptured,
    reap: reapProcessTree,
    fetch: globalThis.fetch,
    log: rememberLog,
    token: randomBytes(32).toString('base64url'),
    env: process.env,
    node: process.execPath,
    generatorPath: () => path.join(hermesHome(), 'tachles', 'community', 'scripts', 'community-generate.mjs'),
    ...deps
  }
  let child = null
  let baseUrl = null
  let inFlight = null
  let state = {
    provisioned: false,
    active: false,
    target: 'business',
    running: false,
    starting: false,
    gatewayStarted: false,
    error: null
  }

  const snapshot = () => ({ ...state })
  const patch = partial => (state = { ...state, ...partial })

  async function startGateway(install) {
    try {
      await io.runCaptured(
        install.layout.python,
        ['-m', 'hermes_cli.main', 'gateway', 'start'],
        60_000,
        { HERMES_HOME: install.layout.home, HERMES_NONINTERACTIVE: '1' }
      )
      return { started: true, error: null }
    } catch (error) {
      const message = `Community gateway failed to start: ${String(error.message || error)}`
      io.log(`[community] ${message}`)
      return { started: false, error: message }
    }
  }

  async function start() {
    if (inFlight) return inFlight
    inFlight = (async () => {
      const install = io.inspect({ env: io.env })
      patch({
        provisioned: install.provisioned,
        active: Boolean(install.active),
        target: install.active ? 'community' : 'business',
        error: install.reason,
        starting: Boolean(install.active && !state.running)
      })
      if (!install.active) {
        stopWebSurface()
        return snapshot()
      }
      if (state.running && baseUrl) {
        if (state.gatewayStarted) return patch({ starting: false, error: null })
        const gateway = await startGateway(install)
        return patch({ starting: false, gatewayStarted: gateway.started, error: gateway.error })
      }
      let port
      try {
        port = await io.choosePort(COMMUNITY_PREFERRED_PORT, COMMUNITY_PORT_RANGE)
      } catch (error) {
        patch({ running: false, starting: false, error: String(error.message || error) })
        return snapshot()
      }
      baseUrl = `http://127.0.0.1:${port}`
      const childEnv = {
        ...io.env,
        HERMES_HOME: install.layout.home,
        HERMES_DASHBOARD_SESSION_TOKEN: io.token,
        HERMES_DESKTOP: '1'
      }
      let instance
      try {
        instance = io.spawn(
          install.layout.python,
          ['-m', 'hermes_cli.main', 'serve', '--host', '127.0.0.1', '--port', String(port)],
          { cwd: install.layout.engine, env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
        )
      } catch (error) {
        baseUrl = null
        patch({ running: false, starting: false, error: String(error.message || error) })
        return snapshot()
      }
      child = instance
      instance.stdout?.on('data', chunk => io.log(`[community] ${chunk}`))
      instance.stderr?.on('data', chunk => io.log(`[community] ${chunk}`))
      instance.on('error', error => {
        io.log(`[community] runtime spawn failed: ${error.message || error}`)
        if (child === instance) patch({ running: false, starting: false, gatewayStarted: false, error: String(error.message || error) })
      })
      instance.on('exit', code => {
        if (child !== instance) return
        child = null
        baseUrl = null
        patch({ running: false, starting: false, gatewayStarted: false, error: code ? `Community runtime exited (${code})` : null })
      })
      try {
        await io.waitForHealth({ baseUrl, token: io.token })
        const gateway = await startGateway(install)
        patch({ running: true, starting: false, gatewayStarted: gateway.started, error: gateway.error })
      } catch (error) {
        if (child === instance) child = null
        baseUrl = null
        io.reap(instance)
        patch({ running: false, starting: false, gatewayStarted: false, error: String(error.message || error) })
      }
      return snapshot()
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  async function api(endpoint, init = {}) {
    const ready = await start()
    if (!ready.running || !ready.gatewayStarted || !baseUrl) {
      throw new Error(ready.error || 'Community Hermes gateway is not running')
    }
    const response = await io.fetch(`${baseUrl}${endpoint}`, {
      method: init.method || 'GET',
      headers: authHeaders(io.token, init.body ? { 'Content-Type': 'application/json' } : {}),
      body: init.body ? JSON.stringify(init.body) : undefined
    })
    const text = await response.text()
    const payload = text ? JSON.parse(text) : {}
    if (!response.ok) throw new Error(payload.detail || payload.error || `Hermes returned HTTP ${response.status}`)
    if (endpoint === '/api/model/set' && (init.method || 'GET').toUpperCase() === 'POST') {
      const install = io.inspect({ env: io.env })
      // Hermes' model endpoint owns the root config. Multiplexed WhatsApp turns
      // resolve model config from their routed profile homes, so immediately
      // rerun the canonical generator to mirror the now-authoritative root
      // model into EVERY profile, then restart the hash-scoped gateway.
      await io.runCaptured(
        io.node,
        [io.generatorPath(), 'generate', '--contract', install.layout.contract, '--home', install.layout.home],
        60_000,
        {
          HERMES_HOME: install.layout.home,
          HERMES_NONINTERACTIVE: '1',
          ELECTRON_RUN_AS_NODE: '1'
        }
      )
      try {
        await io.runCaptured(
          install.layout.python,
          ['-m', 'hermes_cli.main', 'gateway', 'restart'],
          60_000,
          { HERMES_HOME: install.layout.home, HERMES_NONINTERACTIVE: '1' }
        )
        patch({ gatewayStarted: true, error: null })
      } catch (error) {
        patch({ gatewayStarted: false, error: `Community gateway restart failed: ${String(error.message || error)}` })
        throw error
      }
    }
    return payload
  }

  function status() {
    const install = io.inspect({ env: io.env })
    if (!install.active && child) stopWebSurface()
    return patch({
      provisioned: install.provisioned,
      active: Boolean(install.active),
      target: install.active ? 'community' : 'business',
      gatewayStarted: install.active ? state.gatewayStarted : false,
      error: install.active ? state.error : install.reason
    })
  }

  function stopWebSurface() {
    const instance = child
    child = null
    baseUrl = null
    if (instance) io.reap(instance)
    return patch({ running: false, starting: false, gatewayStarted: false })
  }

  return { start, api, status, stopWebSurface }
}

const communityRuntime = createCommunityRuntime()

module.exports = {
  createCommunityRuntime,
  getCommunityRuntime: communityRuntime.status,
  startCommunityRuntime: communityRuntime.start,
  communityApi: communityRuntime.api,
  stopCommunityWebSurface: communityRuntime.stopWebSurface
}
