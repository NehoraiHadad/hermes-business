// The authoritative health-response interpreter + shared health types. The support
// screen must NEVER show "everything is healthy" when an authoritative layer says
// otherwise, returns malformed data, or the request fails. Every path here fails
// CLOSED: anything we cannot positively confirm as healthy is surfaced as a problem,
// never hidden. The UI panel that renders these types lives in health-panel.ts.

export type HealthState = 'ok' | 'warning' | 'error'

export type HealthComponent = {
  id: string
  label: string
  value: string
  state: HealthState
}

export type HealthReport = {
  healthy: boolean
  summary: string
  components: HealthComponent[]
}

export type HealthVerdict = { healthy: boolean; reason: string }

// Read failures for authoritative lists. A failed read is NOT an empty healthy list —
// "0 tasks" and "could not read tasks" are different truths and must look different.
export type LoadErrors = { tasks?: boolean; connections?: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// Hermes 0.19.1 reports a component/overall status as exactly "ok" or "degraded"; the
// gateway process readiness uses the same binary. We keep a wider vocabulary so any
// error/down/failed dialect from a nested probe is still treated as a problem.
const HEALTHY_TOKENS = new Set(['ok', 'healthy', 'up', 'running', 'ready', 'pass', 'passed', 'active', 'operational', 'online', 'connected', 'draining'])
const UNHEALTHY_TOKENS = new Set([
  'degraded', 'down', 'error', 'errored', 'failed', 'failing', 'unhealthy', 'stopped',
  'crashed', 'offline', 'dead', 'unreachable', 'fault', 'critical', 'startup_failed', 'timeout'
])

// Verdict for a single status/state string: bad on an explicit negative token, ok on a
// known-good token, unknown otherwise (so a stray non-status string never false-flags).
function tokenVerdict(value: unknown): 'ok' | 'bad' | 'unknown' {
  if (typeof value !== 'string') return 'unknown'
  const v = value.trim().toLowerCase()
  if (UNHEALTHY_TOKENS.has(v)) return 'bad'
  if (HEALTHY_TOKENS.has(v)) return 'ok'
  return 'unknown'
}

// The rollup MUST report these components; a healthy verdict requires each to be
// present AND positively ok. A missing/incomplete/malformed component is unhealthy —
// "we did not see gateway" is not "gateway is fine".
export const REQUIRED_STATUS_COMPONENTS = ['gateway', 'dashboard', 'storage', 'platforms'] as const

// A single named component is healthy only when it positively proves it: no ok:false /
// healthy:false, no explicit bad token, and at least one of status/state is a known-good
// token. An object with no recognisable signal is 'incomplete' (treated unhealthy).
function componentHealthy(node: unknown): boolean {
  if (!isRecord(node)) return false
  if (node.ok === false || node.healthy === false) return false
  const sv = tokenVerdict(node.status)
  const stv = tokenVerdict(node.state)
  if (sv === 'bad' || stv === 'bad') return false
  if (node.ok === true || node.healthy === true) return true
  return sv === 'ok' || stv === 'ok'
}

// Walk the /api/status tree explicitly + recursively (depth-bounded) collecting every
// node that reports a negative signal: ok:false, healthy:false, or a status/state that
// is an explicit unhealthy token. This handles the real nested shape
// (status.components.<name>.status) AND any flatter dialect, without a pathological scan.
function collectUnhealthy(node: unknown, depth: number, path: string, out: Set<string>): void {
  if (depth > 5 || !isRecord(node)) return
  const here = path || 'status'
  if (node.ok === false || node.healthy === false) out.add(here)
  if (tokenVerdict(node.status) === 'bad' || tokenVerdict(node.state) === 'bad') out.add(here)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'ok' || key === 'healthy' || key === 'status' || key === 'state') continue
    if (isRecord(value)) collectUnhealthy(value, depth + 1, key, out)
  }
}

// Interpret the authoritative { health, status } from hermesClient.healthCheck
// (/api/health = process liveness; /api/status = the real rollup with `overall` and
// `components.<name>.status`). Fail closed on malformed data, a missing payload, an
// explicit ok:false, a non-ok overall, or any unhealthy component.
export function interpretHealthResponse(raw: unknown): HealthVerdict {
  if (!isRecord(raw)) return { healthy: false, reason: 'תשובת תקינות לא תקינה' }
  const health = raw.health
  if (!isRecord(health)) return { healthy: false, reason: 'חסר מידע תקינות מ־Hermes' }
  if (health.ok !== true) {
    const message = typeof health.message === 'string' && health.message ? health.message : 'שרת Hermes דיווח על תקלה'
    return { healthy: false, reason: message }
  }
  // The rollup is REQUIRED. A missing/malformed status object is not "healthy by
  // omission" — the exact 0.19.1 contract (overall + components.<name>.status) must be
  // present and positively ok, or we fail closed.
  const status = raw.status
  if (!isRecord(status)) return { healthy: false, reason: 'מידע מצב המערכת חסר או פגום' }
  const components = status.components
  if (!isRecord(components)) return { healthy: false, reason: 'רשימת רכיבי המערכת חסרה' }

  const bad = new Set<string>()
  // `overall` is a plain string; it must positively read ok (unknown/absent ⇒ unhealthy).
  if (tokenVerdict(status.overall) !== 'ok') bad.add('overall')
  // Every required component must be present AND positively ok — missing = incomplete = unhealthy.
  for (const name of REQUIRED_STATUS_COMPONENTS) {
    if (!componentHealthy(components[name])) bad.add(name)
  }
  // Also catch any OTHER component that reports a negative signal (defence in depth).
  collectUnhealthy(components, 0, 'status', bad)
  if (bad.size) return { healthy: false, reason: `רכיבים לא תקינים: ${[...bad].join(', ')}` }
  return { healthy: true, reason: 'כל השכבות דיווחו על תקינות' }
}

// Race a promise against a timeout so a hung request can never leave the UI unable
// to distinguish "healthy" from "never answered". Rejects (fails closed) on timeout.
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('health check timed out')), ms)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}
