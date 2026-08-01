// Read-only gateway JSON-RPC for the installed-companion E2E suites. Every call
// runs inside the renderer via page.evaluate against the runtime bridge's
// WebSocket URL. The denied-approval driver lives in installed-approval.mjs.

/**
 * JSON-RPC call over the gateway WebSocket from inside the renderer. The whole
 * body runs in the browser context via page.evaluate, so it may only reference
 * `window` and the single serialized `request` argument.
 */
export async function gatewayRpc(page, method, params, { id = 'e2e-config', timeoutMs = 20_000 } = {}) {
  return page.evaluate(async request => {
    const runtime = await window.hermesDesktop.getRuntime()
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(runtime.wsUrl)
      const timer = window.setTimeout(() => {
        socket.close()
        reject(new Error(`Gateway RPC timed out: ${request.method}`))
      }, request.timeoutMs)
      socket.addEventListener('open', () => {
        socket.send(
          JSON.stringify({ jsonrpc: '2.0', id: request.id, method: request.method, params: request.params })
        )
      })
      socket.addEventListener('message', event => {
        const frame = JSON.parse(String(event.data))
        if (frame.id !== request.id) return
        window.clearTimeout(timer)
        socket.close()
        if (frame.error) reject(new Error(frame.error.message || 'Gateway RPC failed'))
        else resolve(frame.result)
      })
      socket.addEventListener('error', () => {
        window.clearTimeout(timer)
        reject(new Error('Gateway RPC socket failed'))
      })
    })
  }, { method, params, id, timeoutMs })
}

/** Return the runtime `session.list` result from inside the renderer. */
export async function listSessions(
  page,
  { limit = 100, id = 'installed-ui-session-list', timeoutMs = 20_000 } = {}
) {
  return page.evaluate(async request => {
    const runtime = await window.hermesDesktop.getRuntime()
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(runtime.wsUrl)
      const timer = window.setTimeout(() => {
        socket.close()
        reject(new Error('session.list verification timed out'))
      }, request.timeoutMs)
      socket.addEventListener('open', () => {
        socket.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            method: 'session.list',
            params: { limit: request.limit }
          })
        )
      })
      socket.addEventListener('message', event => {
        const frame = JSON.parse(String(event.data))
        if (frame.id !== request.id) return
        window.clearTimeout(timer)
        socket.close()
        resolve(frame.result?.sessions || [])
      })
      socket.addEventListener('error', () => {
        window.clearTimeout(timer)
        reject(new Error('Could not verify the shared Hermes session'))
      })
    })
  }, { limit, id, timeoutMs })
}

/** Find the session whose title or preview contains a unique marker. */
export async function findSessionByMarker(page, marker, options = {}) {
  const sessions = await listSessions(page, options)
  return (
    sessions.find(session => `${session.title || ''} ${session.preview || ''}`.includes(marker)) || null
  )
}
