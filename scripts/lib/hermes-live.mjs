// Live-Hermes harness: owns the spawned `hermes serve` process, the gateway
// WebSocket, request/response correlation and the event stream. Imports
// child_process, so only the live suite (e2e-hermes.mjs) should import this.

import { spawn, spawnSync } from 'node:child_process'
import { sanitize } from './e2e-harness.mjs'

/** Collapse an arbitrarily nested skills payload into a flat list of names. */
export function flattenSkillNames(value) {
  if (Array.isArray(value)) return value.flatMap(flattenSkillNames)
  if (value && typeof value === 'object') {
    if (typeof value.name === 'string') return [value.name]
    return Object.values(value).flatMap(flattenSkillNames)
  }
  return typeof value === 'string' ? [value] : []
}

/**
 * Create a stateful harness around a live Hermes server. The returned object
 * exposes the process lifecycle (startServer/connectSocket/shutdown), JSON-RPC
 * (`rpc`), event polling (`waitForEvent`) and the redacted `serverOutput`
 * buffer. All stdout/stderr is sanitized on capture.
 */
export function createHermesHarness({ hermes, hermesHome, port, token, wsUrl, extraEnv = {} }) {
  let server = null
  let socket = null
  let nextId = 0
  const pending = new Map()
  const events = []
  const serverOutput = []

  function stage(message) {
    console.error(`[e2e] ${message}`)
  }

  function startServer() {
    server = spawn(hermes, ['serve', '--host', '127.0.0.1', '--port', String(port)], {
      env: {
        ...process.env,
        ...extraEnv,
        HERMES_HOME: hermesHome,
        HERMES_DASHBOARD_SESSION_TOKEN: token,
        HERMES_DESKTOP: '1'
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    server.stdout.on('data', chunk => serverOutput.push(sanitize(chunk)))
    server.stderr.on('data', chunk => serverOutput.push(sanitize(chunk)))
    return server
  }

  async function connectSocket() {
    socket = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket connection timed out')), 20_000)
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true }
      )
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer)
          reject(new Error('WebSocket connection failed'))
        },
        { once: true }
      )
      socket.addEventListener('message', message => {
        const frame = JSON.parse(String(message.data))
        if (frame.id != null) {
          const request = pending.get(String(frame.id))
          if (!request) return
          clearTimeout(request.timer)
          pending.delete(String(frame.id))
          if (frame.error) request.reject(new Error(frame.error.message || 'Hermes RPC failed'))
          else request.resolve(frame.result)
          return
        }
        if (frame.method === 'event' && frame.params?.type) events.push(frame.params)
      })
    })
    return socket
  }

  function rpc(method, params = {}, timeoutMs = 180_000) {
    const id = `e2e-${++nextId}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`RPC timed out: ${method}`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  function waitForEvent(predicate, timeoutMs = 180_000, fromIndex = 0) {
    const existing = events.slice(fromIndex).find(predicate)
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs
      const timer = setInterval(() => {
        const event = events.slice(fromIndex).find(predicate)
        if (event) {
          clearInterval(timer)
          resolve(event)
        } else if (Date.now() >= deadline) {
          clearInterval(timer)
          reject(new Error('Gateway event timed out'))
        }
      }, 50)
    })
  }

  function stopServer() {
    if (!server?.pid) return
    if (process.platform === 'win32') {
      spawnSync('taskkill.exe', ['/pid', String(server.pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore'
      })
    } else {
      server.kill('SIGTERM')
    }
  }

  function shutdown() {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('E2E test shut down'))
    }
    pending.clear()
    socket?.close()
    stopServer()
  }

  return {
    events,
    serverOutput,
    get socket() {
      return socket
    },
    get server() {
      return server
    },
    stage,
    startServer,
    connectSocket,
    rpc,
    waitForEvent,
    stopServer,
    shutdown
  }
}
