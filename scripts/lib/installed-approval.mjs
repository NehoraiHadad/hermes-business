// Real, denied-approval driver for the installed-companion E2E. Kept apart from
// the read-only gateway RPCs because the whole body runs in the renderer's
// browser context via page.evaluate as ONE serialized function.

/**
 * Drive a real, denied approval end-to-end over the gateway's JSON-RPC/event
 * path from inside the renderer — NOT a synthetic renderer modal. Creates a
 * session, forces manual approval, submits a prompt that asks the agent to run a
 * guarded local command, waits for the official `approval.request` event, denies
 * it via `approval.respond {choice:'deny'}`, then interrupts the turn. Returns a
 * trace of exactly what the gateway did.
 */
export async function elicitAndDenyApproval(page, { text, timeoutMs = 180_000 } = {}) {
  return page.evaluate(
    async req =>
      new Promise(resolve => {
        const trace = {
          connected: false,
          sessionId: null,
          submitted: false,
          requested: false,
          requestCommandPresent: false,
          choices: null,
          denied: false,
          denyResolvedCount: null,
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
          ws.addEventListener('message', async event => {
            let frame
            try {
              frame = JSON.parse(String(event.data))
            } catch {
              return
            }
            if (frame.id != null && pending.has(frame.id)) {
              const p = pending.get(frame.id)
              pending.delete(frame.id)
              if (frame.error) p.rej(new Error(frame.error.message || 'rpc error'))
              else p.res(frame.result)
              return
            }
            if (frame.method === 'event' && frame.params && frame.params.type) {
              trace.events.push(frame.params.type)
              if (frame.params.type === 'approval.request' && !approvalSeen) {
                approvalSeen = true
                trace.requested = true
                const payload = frame.params.payload || {}
                trace.requestCommandPresent = Boolean(payload.command)
                trace.choices = payload.choices || null
                try {
                  const result = await call('approval.respond', {
                    session_id: trace.sessionId,
                    choice: 'deny'
                  })
                  trace.denied = true
                  trace.denyResolvedCount = result && typeof result.resolved === 'number' ? result.resolved : null
                } catch (e) {
                  trace.error = `deny failed: ${e.message}`
                }
                try {
                  await call('session.interrupt', { session_id: trace.sessionId })
                } catch {
                  /* best effort */
                }
                window.clearTimeout(deadline)
                finish()
              }
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
      }),
    { text, timeoutMs }
  )
}
