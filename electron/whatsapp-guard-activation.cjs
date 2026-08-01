const { installWhatsappPolicyPlugin } = require('./whatsapp-plugin-install.cjs')
const {
  verifyGuardHeartbeat,
  readGuardHeartbeat,
  installedPluginVersion,
  isPidAlive
} = require('./whatsapp-guard.cjs')
const { officialGatewayState } = require('./gateway-status.cjs')
const {
  writeGuardActivationJournal,
  clearGuardActivationJournal,
  readGuardActivationJournal
} = require('./whatsapp-guard-journal.cjs')

// Activates the fail-closed messaging guard as one OBSERVABLE, RECOVERABLE transaction. The
// restart decision keys off the OFFICIAL pre-install gateway process state (running/stopped/
// unknown) — NOT the heartbeat, which an old pre-heartbeat gateway never publishes:
//   * changed + already running → mandatory official restart, then require a FRESH heartbeat
//   * changed + started fresh AFTER install → new code already loaded → no restart, verify fresh
//   * changed + status UNKNOWN → fail closed (cannot prove the old code was superseded)
//   * unchanged → verify the current heartbeat; no restart
// Restart failure or a heartbeat timeout on the mandatory-restart path FAILS CLOSED (blocked).

const DEFAULT_TIMEOUT_MS = 45_000
const DEFAULT_INTERVAL_MS = 1_000
const NON_CLEARABLE = new Set(['restarting', 'verifying', 'failed'])

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function officialGatewayRestart() {
  const { hermesApi } = require('./runtime.cjs')
  return hermesApi('/api/gateway/restart', { method: 'POST' })
}

// Poll the gateway heartbeat until one positively verifies (fresh nonce when superseding),
// or the deadline passes. Returns the verified guard object or null (timeout / never fresh).
async function waitForFreshHeartbeat(opts = {}) {
  const readHeartbeat = opts.readHeartbeat || readGuardHeartbeat
  const now = opts.now || Date.now
  const wait = opts.sleep || sleep
  // Use ?? so an explicit 0 (probe once, then give up) is honored — `0 || DEFAULT` would
  // wrongly restore the 45s default and, with a frozen test clock, never terminate.
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const interval = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  const verify = opts.verify || verifyGuardHeartbeat
  const deadline = now() + timeout
  for (;;) {
    const verified = verify(readHeartbeat('gateway'), {
      installedVersion: opts.expectedVersion,
      supersedeNonce: opts.supersedeNonce,
      isPidAlive: opts.isPidAlive || isPidAlive,
      now: now()
    })
    if (verified) return verified
    if (now() >= deadline) return null
    await wait(interval)
  }
}

function fail(reason, over = {}) {
  writeGuardActivationJournal({ status: 'failed', reason, ...over })
  return { active: false, blocked: over.blocked !== false, reason, phase: 'failed', ...over }
}

// Clear only a clean/absent/stale-active journal in the pending path. NEVER silently wipe an
// in-flight or 'failed' journal — that record is owed to recoverGuardActivation and the UI.
function clearIfSafe() {
  const existing = readGuardActivationJournal()
  if (!existing || !NON_CLEARABLE.has(existing.status)) clearGuardActivationJournal()
}

async function activateWhatsappGuard(options = {}) {
  const install = (options.install || installWhatsappPolicyPlugin)()
  const expectedVersion = (options.installedVersion || installedPluginVersion)()
  const restart = options.restart || officialGatewayRestart

  if (!install || !install.ok) {
    return fail(install && install.error ? install.error : 'install-failed', { changed: false })
  }
  // Not enforcing (e.g. Hermes not found) → unsafe → fail closed (distinct from 'pending' below).
  if (!install.enabled) {
    return fail(install.reason || 'not-enabled', { changed: Boolean(install.changed) })
  }

  const changed = Boolean(install.changed)
  const startedFresh = Boolean(options.gatewayStartedFresh)
  // Authoritative pre-install process state (running/stopped/unknown). main.cjs captures it
  // BEFORE install + ensureGatewayBackground and passes it in; a runtime caller (policy set)
  // self-probes LAZILY — the official CLI is a subprocess, so it runs only when the payload
  // changed (restart decision) or the tail actually needs it. Replaces the heartbeat-presence proxy.
  let cachedState
  const priorState = () => {
    if (options.priorGatewayState !== undefined) return options.priorGatewayState
    if (cachedState === undefined) cachedState = (options.officialGatewayState || officialGatewayState)().state
    return cachedState
  }

  if (changed) {
    // Cannot prove whether an old-code gateway is running → fail closed.
    if (priorState() === 'unknown') return fail('gateway-status-unknown', { changed })

    // Already running the OLD code before install → mandatory official restart + FRESH heartbeat.
    // supersedeNonce is best-effort (a pre-heartbeat gateway has none); the restart is mandated
    // by the official state, not by heartbeat presence.
    if (priorState() === 'running') {
      const before = (options.readHeartbeat || readGuardHeartbeat)('gateway')
      const supersedeNonce = before && before.nonce ? before.nonce : null
      writeGuardActivationJournal({ status: 'restarting', changed, supersedeNonce, expectedVersion })
      try {
        const res = await restart()
        if (res && res.ok === false) throw new Error(res.error || 'gateway restart rejected')
      } catch (error) {
        return fail(`restart-failed: ${error.message || error}`, { changed, restarted: false })
      }
      writeGuardActivationJournal({ status: 'verifying', changed, supersedeNonce, expectedVersion })
      const verified = await waitForFreshHeartbeat({ ...options, expectedVersion, supersedeNonce })
      if (!verified) return fail('heartbeat-timeout', { changed, restarted: true })
      writeGuardActivationJournal({ status: 'active', changed, expectedVersion })
      return { active: true, blocked: false, changed, restarted: true, phase: 'active' }
    }
    // priorState === 'stopped' + started fresh AFTER install → new process already loaded new
    // code; no redundant restart. Fall through to verify a fresh heartbeat.
  }

  // No mandatory restart. Require a live heartbeat; poll when a gateway is (or was just) up,
  // else probe once → pending. No supersede — the current process IS the valid one. Short-circuit
  // on startedFresh so the common unchanged policy-save never pays for a status subprocess.
  const gatewayUp = startedFresh || priorState() === 'running'
  const verified = await waitForFreshHeartbeat({
    ...options,
    expectedVersion,
    supersedeNonce: null,
    timeoutMs: options.timeoutMs ?? (gatewayUp ? 5_000 : 0)
  })
  if (verified) {
    writeGuardActivationJournal({ status: 'active', changed, expectedVersion })
    return { active: true, blocked: false, changed, restarted: false, phase: 'active' }
  }
  // Installed + enabled but no live proof yet. Safe to keep configuring; the status reader stays
  // fail-closed until a real heartbeat appears.
  clearIfSafe()
  return { active: false, blocked: false, changed, restarted: false, reason: 'no-heartbeat', phase: 'pending' }
}

module.exports = { activateWhatsappGuard, waitForFreshHeartbeat, officialGatewayRestart }
