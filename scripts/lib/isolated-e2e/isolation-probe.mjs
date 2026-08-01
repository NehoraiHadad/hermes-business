// ISOLATION CASE for the isolated packaged E2E: read the running app's QA proof
// surface, prove it is in qa-isolated mode on OUR port with the throwaway home,
// and count the isolated baseline sessions — all BEFORE any prompt/seed/approval.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { hermesHomeMarker } from '../isolated-marker.mjs'

const homeKey = p => path.resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase()

/**
 * EXECUTABLE proof read from the LIVE binary (not source): assemble the structural
 * isolation verdict from the runtime bridge state. `qaNamespaceApplied` is true
 * only when the QA Electron namespace flag is set AND the running app's embedded
 * attestation nonce matches the manifest verified pre-launch — so the binary we
 * launched IS the freshly attested win-unpacked artifact.
 */
export function assessRuntimeIsolation({ runtime, isolatedPort, tempHome, expectedNonce, liveSessionCountBefore }) {
  const wsPort = Number((String(runtime?.wsUrl || '').match(/:(\d+)\//) || [])[1])
  const runtimeMode = runtime?.mode || null
  const diagnosticsHome = runtime?.hermesHome || null
  const wsOnIsolatedPort = wsPort === isolatedPort
  const qa = runtime?.qa || null
  const runningNonce = qa?.attestation?.nonce || null
  const nonceMatch = Boolean(expectedNonce && runningNonce && runningNonce === expectedNonce)
  const diagnosticsHomeIsTemp = Boolean(diagnosticsHome) && homeKey(diagnosticsHome) === homeKey(tempHome)
  return {
    wsPort,
    runtimeMode,
    diagnosticsHome,
    wsOnIsolatedPort,
    nonceMatch,
    qaNamespaceApplied: Boolean(qa?.namespaceApplied) && nonceMatch,
    qaNamespacePresent: Boolean(qa?.namespaceApplied),
    isolation: {
      runtime_mode: runtimeMode,
      runtime_running: Boolean(runtime?.running),
      isolated_port: isolatedPort,
      ws_on_isolated_port: wsOnIsolatedPort,
      diagnostics_home_is_temp: diagnosticsHomeIsTemp,
      isolated_session_count: null,
      live_session_count_before: liveSessionCountBefore,
      isolated_home_populated: null
    }
  }
}

/**
 * Count sessions over the ISOLATED gateway URL exposed by the runtime bridge
 * (never the live REST base). Only call this AFTER the structural gate proves
 * isolation. Returns a count, or an `error: <msg>` string the precondition check
 * then treats as a hard fail.
 */
export async function queryIsolatedSessionCount(page) {
  try {
    const sessions = await page.evaluate(async () => {
      const rt = await window.hermesDesktop.getRuntime()
      return await new Promise((resolve, reject) => {
        const ws = new WebSocket(rt.wsUrl)
        const timer = setTimeout(() => reject(new Error('session.list timeout')), 15000)
        ws.addEventListener('open', () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 'x', method: 'session.list', params: { limit: 100 } })))
        ws.addEventListener('message', ev => { const f = JSON.parse(String(ev.data)); if (f.id === 'x') { clearTimeout(timer); ws.close(); resolve(f.result?.sessions || []) } })
        ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('ws error')) })
      })
    })
    return Array.isArray(sessions) ? sessions.length : null
  } catch (e) {
    return `error: ${e.message}`
  }
}

/** True when the isolated temp home shows any populated profile state. */
export function isolatedHomePopulated(tempHome) {
  const marker = hermesHomeMarker(tempHome)
  return Boolean(
    marker.configPresent ||
      existsSync(path.join(tempHome, 'state.db')) ||
      Object.values(marker.inventory).some(n => n > 0) ||
      existsSync(path.join(tempHome, 'SOUL.md'))
  )
}
