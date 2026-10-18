import { HermesServerRequests } from '../../shared/server-requests.js'

// Real, denied-approval driver for the installed-companion E2E. Kept apart from
// the read-only gateway RPCs because the whole body runs in the renderer's
// browser context via page.evaluate as ONE serialized function.

/**
 * Drive a real, denied approval end-to-end over the gateway's JSON-RPC/event
 * path from inside the renderer — NOT a synthetic renderer modal. Creates a
 * session, forces manual approval, submits a prompt that asks the agent to run a
 * guarded local command, waits for the native `approval` server request, replies
 * with the same JSON-RPC id and `{choice:'deny'}`, then interrupts the turn. Returns a
 * trace of exactly what the gateway did.
 */
export async function elicitAndDenyApproval(page, { text, timeoutMs = 180_000 } = {}) {
  // Embed the product's self-contained class in the serialized browser function;
  // no second protocol implementation and no browser eval/CSP exception.
  const drive = new Function('req', `return (${rendererApproval.toString()})(req, ${HermesServerRequests.toString()})`)
  return page.evaluate(drive, { text, timeoutMs })
}

const rendererApproval = async (req, RequestChannel) =>
      new Promise(resolve => {
        const trace = {
          connected: false,
          sessionId: null,
          submitted: false,
          requested: false,
          requestCommandPresent: false,
          choices: null,
          denied: false,
          responseSent: false,
          events: [],
          error: null
        }
        let approvalSeen = false
        let nextId = 0
        const pending = new Map()
        let ws
        const finish = () => {
          try {
            ws && ws.close()
          } catch {
            /* ignore */
          }
          resolve(trace)
        }
        const call = (method, params) =>
          new Promise((res, rej) => {
            const id = `iso-${(nextId += 1)}`
            pending.set(id, { res, rej })
            ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
          })
        ;(async () => {
          const runtime = await window.hermesDesktop.getRuntime()
          ws = new WebSocket(runtime.wsUrl)
          const deadline = window.setTimeout(() => {
            trace.error = trace.error || 'timed out waiting for approval.request'
            finish()
          }, req.timeoutMs)
          const channel = new RequestChannel(frame => ws.send(JSON.stringify(frame)), async event => {
            trace.events.push(event.type)
            if (event.type !== 'approval.request' || approvalSeen) return
            approvalSeen = true
            trace.requested = true
            trace.requestCommandPresent = Boolean(event.payload.command)
            trace.choices = event.payload.choices || null
            try {
              channel.respond(event.payload.request_id, { choice: 'deny' })
              trace.responseSent = true
              // Responses have no JSON-RPC acknowledgement. A subsequent RPC on
              // this socket proves the ordered connection remains usable.
              await call('session.interrupt', { session_id: trace.sessionId })
              trace.denied = true
            } catch (error) { trace.error = `deny failed: ${error.message}` }
            window.clearTimeout(deadline)
            finish()
          })
          ws.addEventListener('message', event => {
            let frame
            try { frame = JSON.parse(String(event.data)) } catch { return }
            if (frame.id != null && frame.method) { channel.accept(frame); return }
            if (frame.id != null && pending.has(frame.id)) {
              const entry = pending.get(frame.id)
              pending.delete(frame.id)
              if (frame.error) entry.rej(new Error(frame.error.message || 'rpc error'))
              else entry.res(frame.result)
            } else if (frame.method === 'event' && frame.params?.type) {
              trace.events.push(frame.params.type)
              if (frame.params.type === 'request.cancel') channel.cancel(frame.params.payload || {})
            }
          })
          ws.addEventListener('error', () => {
            trace.error = trace.error || 'gateway socket error'
            window.clearTimeout(deadline)
            finish()
          })
          ws.addEventListener('open', async () => {
            trace.connected = true
            try {
              channel.advertise()
              const created = await call('session.create', { source: 'desktop', cols: 96 })
              trace.sessionId = created.session_id
              await call('config.set', { key: 'approvals.mode', value: 'manual' })
              await call('prompt.submit', { session_id: trace.sessionId, text: req.text })
              trace.submitted = true
            } catch (e) {
              trace.error = `setup failed: ${e.message}`
              window.clearTimeout(deadline)
              finish()
            }
          })
        })().catch(e => {
          trace.error = trace.error || String(e.message || e)
          finish()
        })
      })
