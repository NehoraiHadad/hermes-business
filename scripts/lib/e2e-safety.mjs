// The gate that decides whether an installed-companion E2E may run at all.
//
// The point of this module is to PROVE isolation, not to look for a token. The
// old version passed on either a bare `HERMES_BUSINESS_QA_RUNTIME` string — which
// can linger in an ambient shell long after the temp home it referred to was
// deleted — or on the honour-system `HERMES_BUSINESS_DISPOSABLE_WINDOWS=1`. Both
// verified nothing, so a "safe" run could still drive the packaged app against
// the operator's LIVE Hermes profile.
//
// The QA branch now demands the COMPLETE quadruple that electron/qa-runtime.cjs
// itself requires, and re-validates it here with the SAME policy module the main
// process uses (electron/qa-runtime-policy.cjs `validateHost`/`validatePort`) plus
// the shared containment check in ./isolated-runtime.mjs:
//
//   1. HERMES_BUSINESS_QA_RUNTIME === 'isolated-temp-home'   (sentinel)
//   2. HERMES_BUSINESS_QA_HERMES_HOME  absolute, existing, non-symlink directory
//      whose canonical path is strictly under the OS TEMP root and never inside
//      the live Hermes profile
//   3. HERMES_BUSINESS_QA_HOST         loopback (default 127.0.0.1)
//   4. HERMES_BUSINESS_QA_PORT         inside the safe high range, never 9119
//
// A stale sentinel now fails on (2): the temp home it named no longer exists.
//
// Constants are imported, never re-typed: the sentinel and port bounds come from
// ./isolated-runtime.mjs (which electron/constants-lockstep.test.ts pins against
// electron/qa-runtime-policy.cjs), so this file holds no third literal copy.

import { requireElectron } from './electron-require.mjs'
import {
  QA_SENTINEL_ENV,
  QA_SENTINEL_VALUE,
  QA_HOME_ENV,
  QA_HOST_ENV,
  QA_PORT_ENV,
  assertQaHomeContainment
} from './isolated-runtime.mjs'

// The main-process policy validators, reused verbatim so host/port semantics can
// never drift between "what QA arms" and "what the runtime accepts".
const { validateHost, validatePort } = requireElectron('qa-runtime-policy.cjs')

/** Re-exported for electron/constants-lockstep.test.ts; single source above. */
export const QA_SENTINEL = QA_SENTINEL_VALUE

export const DISPOSABLE_ENV = 'HERMES_BUSINESS_DISPOSABLE_WINDOWS'

const BLOCKED =
  'Installed-app E2E is blocked: this environment does not PROVE isolation from the live Hermes profile.'

/**
 * Evaluate the gate without throwing. Returns
 * `{ ok, mode, home, host, port, reasons: [...] }`.
 *
 * `mode` is `'qa-isolated'` when the full quadruple holds, `'disposable-host'`
 * for the explicit escape hatch, `null` when blocked.
 */
export function evaluateInstalledE2ESafety(env = process.env) {
  const reasons = []
  const requested = Object.prototype.hasOwnProperty.call(env, QA_SENTINEL_ENV)

  if (env[QA_SENTINEL_ENV] === QA_SENTINEL_VALUE) {
    let home = null
    let host = null
    let port = null
    try {
      home = assertQaHomeContainment(env[QA_HOME_ENV], { label: QA_HOME_ENV })
    } catch (error) {
      reasons.push(String(error?.message || error))
    }
    // Presence is required, not just validity: `validateHost` defaults a missing
    // value to loopback, which would let a three-quarter-armed override through.
    if (!env[QA_HOST_ENV]) {
      reasons.push(`${QA_HOST_ENV} must be set explicitly to the loopback host`)
    } else {
      try {
        host = validateHost(env)
      } catch (error) {
        reasons.push(String(error?.message || error))
      }
    }
    try {
      port = validatePort(env)
    } catch (error) {
      reasons.push(String(error?.message || error))
    }
    if (reasons.length === 0) {
      return { ok: true, mode: 'qa-isolated', home, host, port, reasons: [] }
    }
    // A REQUESTED-but-incomplete QA override fails closed and is never rescued by
    // the disposable-host hatch: a half-armed override is the exact shape of the
    // accident this gate exists to stop.
    return { ok: false, mode: null, home: null, host: null, port: null, reasons }
  }

  if (requested) {
    reasons.push(`${QA_SENTINEL_ENV} is set but is not '${QA_SENTINEL_VALUE}'`)
    return { ok: false, mode: null, home: null, host: null, port: null, reasons }
  }

  if (env[DISPOSABLE_ENV] === '1') {
    return { ok: true, mode: 'disposable-host', home: null, host: null, port: null, reasons: [] }
  }

  reasons.push(
    `${QA_SENTINEL_ENV} is not armed (expected '${QA_SENTINEL_VALUE}' together with ` +
      `${QA_HOME_ENV}, ${QA_HOST_ENV} and ${QA_PORT_ENV})`
  )
  return { ok: false, mode: null, home: null, host: null, port: null, reasons }
}

/**
 * Throw unless this environment proves isolation. Returns the verdict descriptor
 * on success so callers can log/report the home and port the run is pinned to.
 *
 * The `HERMES_BUSINESS_DISPOSABLE_WINDOWS=1` escape hatch is retained for a
 * genuinely throwaway Windows VM, but it proves nothing, so it WARNS loudly on
 * every use instead of passing silently.
 */
export function assertSafeInstalledE2E(env = process.env, { warn = console.warn } = {}) {
  const verdict = evaluateInstalledE2ESafety(env)
  if (!verdict.ok) {
    throw new Error(
      `${BLOCKED}\n` +
        verdict.reasons.map(reason => `  - ${reason}`).join('\n') +
        `\nUse the isolated app suite (npm run test:e2e:installed-isolated), which arms the full ` +
        `QA quadruple, or set ${DISPOSABLE_ENV}=1 ONLY inside a disposable Windows VM.`
    )
  }
  if (verdict.mode === 'disposable-host') {
    warn(
      `WARNING: ${DISPOSABLE_ENV}=1 — the installed-app E2E is running with NO proof of isolation. ` +
        'It may read and MUTATE the live Hermes profile of this machine. This escape hatch is for a ' +
        'disposable Windows VM only.'
    )
  }
  return verdict
}
