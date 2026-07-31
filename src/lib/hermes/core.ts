// Shared contracts for the Hermes integration layer. Kept in one place so the
// REST, RPC, provider and session modules agree on function shapes, profile
// routing and the restart/verify handshake instead of re-declaring them.

export type ApiFn = <T>(endpoint: string, init?: { method?: string; body?: unknown }) => Promise<T>
export type RpcFn = <T>(method: string, params?: Record<string, unknown>) => Promise<T>

export const DEFAULT_PROFILE = 'default'

// Append `profile=` consistently. Hermes routes every dashboard endpoint by
// profile; centralising this keeps a single spelling and avoids `?`/`&` bugs.
export function withProfile(path: string, profile: string = DEFAULT_PROFILE): string {
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}profile=${encodeURIComponent(profile)}`
}

// JSON-RPC error that preserves the numeric `code` from the gateway frame so
// callers can branch on protocol semantics (e.g. capability fallback) instead
// of string-matching messages.
export class HermesRpcError extends Error {
  readonly code: number
  constructor(message: string, code: number) {
    super(message)
    this.name = 'HermesRpcError'
    this.code = code
  }
}

// JSON-RPC "unknown method" — Hermes returns this for RPCs a given gateway
// version does not implement (tui_gateway/server.py: `-32601 unknown method`).
export const RPC_METHOD_NOT_FOUND = -32601

// True only for a genuine unknown-method rejection, so a capability fallback
// never masks a real failure (bad params, disconnect, timeout).
export function isMethodNotFound(error: unknown): boolean {
  return error instanceof HermesRpcError && error.code === RPC_METHOD_NOT_FOUND
}

// Provider id -> the env var Hermes stores its API key under. Shared by the
// quick-setup validation and activation paths.
export const PROVIDER_API_KEYS: Record<string, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY'
}

// Build-time capability gate: may THIS bundle ever serve demo fixtures? True
// only in a dev server (`vite dev`) or an explicit QA/test build that bakes in
// `VITE_ALLOW_DEMO`. That flag is derived from the build mode in
// vite.config.ts (`vite build --mode qa`); there is no `.env.qa` file. A normal
// production `vite build` / `package:win` release bakes nothing, so the fixture
// backend is physically absent from the shipping executable — `?demo=1` there
// is inert. This is the hard wall the packaged product must never cross.
export function isDemoBuildAllowed(
  env: { DEV: boolean; VITE_ALLOW_DEMO?: string } = import.meta.env
): boolean {
  if (env.DEV) return true
  const flag = String(env.VITE_ALLOW_DEMO ?? '').trim().toLowerCase()
  return flag === '1' || flag === 'true'
}

// Demo-fixture policy. `?demo=1` is honored ONLY when the build allows demo
// (dev server or an explicit QA/test build) — a normal packaged production
// release ignores it entirely and never fabricates data. Implicit fallback to
// fixtures stays dev-only (no bridge). A non-demo session with no bridge fails
// closed. `ctx` is injectable for tests; in the app every input defaults from
// the runtime globals and the build-time flag.
export function resolveClientMode(ctx?: {
  hasBridge?: boolean
  explicitDemo?: boolean
  isDev?: boolean
  demoAllowed?: boolean
}): { demo: boolean; bridgeMissing: boolean } {
  const hasBridge = ctx?.hasBridge ?? !!window.hermesDesktop
  const isDev = ctx?.isDev ?? import.meta.env.DEV
  const demoAllowed = ctx?.demoAllowed ?? isDemoBuildAllowed()
  const requestedDemo =
    ctx?.explicitDemo ?? new URLSearchParams(window.location.search).get('demo') === '1'
  // A shipping production build can never honor the URL opt-in.
  const explicitDemo = requestedDemo && demoAllowed
  const demo = explicitDemo || (isDev && !hasBridge)
  return { demo, bridgeMissing: !demo && !hasBridge }
}

export type VerifyResult = { ok?: boolean; state?: string; message?: string }

// Restart a subsystem, then poll a verifier until it reports `ok`, hits a
// terminal state, or the attempts run out. One implementation for the
// connect flows that all share "save -> restart gateway -> confirm live".
export async function restartAndVerify<T extends VerifyResult>(opts: {
  restart: () => Promise<unknown>
  verify: () => Promise<T>
  timeoutMessage: string
  attempts?: number
  delayMs?: number
  terminalStates?: string[]
}): Promise<T> {
  const { restart, verify, timeoutMessage } = opts
  const attempts = opts.attempts ?? 20
  const delayMs = opts.delayMs ?? 1000
  const terminalStates = opts.terminalStates ?? ['not_configured', 'startup_failed', 'disabled']
  await restart()
  let last: T = {} as T
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await verify()
    if (last.ok) return last
    if (terminalStates.includes(String(last.state))) break
    await new Promise(resolve => window.setTimeout(resolve, delayMs))
  }
  throw new Error(last.message || timeoutMessage)
}
