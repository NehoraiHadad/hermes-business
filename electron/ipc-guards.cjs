// Pure guards for the main-process IPC boundary. They live here rather than in
// ipc.cjs (which pulls in Electron and every feature module) so the rules that
// protect the boundary are unit-testable on their own.

const EXTENSION = /^[A-Za-z0-9*][A-Za-z0-9+._-]{0,23}$/
const MAX_FILTERS = 24
const MAX_EXTENSIONS = 32
const MAX_NAME = 64

/**
 * Validate the renderer-supplied `filters` argument of `hermes:choose-file`
 * against Electron's documented shape (`{ name: string, extensions: string[] }`)
 * and return a freshly built, sanitized copy — the renderer object itself is
 * never forwarded to `dialog.showOpenDialog`.
 *
 * Anything that does not fit is ignored rather than thrown at the user: a bad
 * filter must not turn "pick a file" into an error dialog. A wholly invalid
 * argument degrades to `[]`, which is exactly "show every file" — the same
 * behaviour the previous `filters || []` fallback had for a missing argument.
 */
function normalizeOpenFileFilters(filters) {
  if (!Array.isArray(filters)) return []
  const normalized = []
  for (const candidate of filters) {
    if (normalized.length >= MAX_FILTERS) break
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    if (typeof candidate.name !== 'string') continue
    const name = candidate.name.trim().slice(0, MAX_NAME)
    if (!name) continue
    if (!Array.isArray(candidate.extensions)) continue
    const extensions = []
    for (const raw of candidate.extensions) {
      if (extensions.length >= MAX_EXTENSIONS) break
      if (typeof raw !== 'string') continue
      // Electron expects bare extensions; a leading dot is a common caller slip.
      const extension = raw.trim().replace(/^\.+/, '')
      if (!EXTENSION.test(extension)) continue
      if (!extensions.includes(extension)) extensions.push(extension)
    }
    if (!extensions.length) continue
    normalized.push({ name, extensions })
  }
  return normalized
}

/**
 * Serialize an IPC-triggered operation that must never run twice at once (the
 * same in-flight-flag idiom `applyOfficialHermesUpdate` uses in
 * hermes-update.cjs). A re-entrant call rejects with `busyMessage` — a
 * user-facing string, since it is rendered verbatim by the renderer — and the
 * flag is always cleared in `finally`, including when the task throws.
 */
function createSerialGuard(busyMessage) {
  let inFlight = false
  return async function runExclusive(task) {
    if (inFlight) throw new Error(busyMessage)
    inFlight = true
    try {
      return await task()
    } finally {
      inFlight = false
    }
  }
}

// --- hermes:api boundary -----------------------------------------------------
//
// The `hermes:api` channel proxies renderer requests onto the AUTHENTICATED
// main-process fetch against the local Hermes gateway (runtime.cjs hermesApi
// attaches the session token). Without a guard it is an unconstrained proxy: a
// compromised renderer could call ANY gateway endpoint with the token, and —
// because hermesApi forwards `init.headers` — even override the auth headers.
// Fail-closed: an endpoint is callable only if it matches a route the product
// actually uses; everything else throws before the token-bearing fetch exists.

const API_MAX_ENDPOINT = 512
const API_MAX_QUERY_VALUE = 128

// One URL path segment as the renderer produces it: encodeURIComponent output,
// i.e. RFC 3986 unreserved characters plus `!'()*` (which encodeURIComponent
// leaves unescaped) plus `%` for escapes. Never contains `/`, `?` or `#`.
const SEG = "[A-Za-z0-9._~%!'()*-]+"

// Every REST route the renderer legitimately reaches through the facade
// (src/lib/hermes/rest-*.ts, providers.ts, business-context/persist.ts and the
// hooks). Anchored on the full path — query string is validated separately.
// The lockstep test in ipc-guards.test.ts scans src/ for `/api/...` literals,
// so a new renderer endpoint fails CI here instead of failing at runtime.
const ALLOWED_API_ROUTES = [
  /^\/api\/(health|status|config|env)$/,
  /^\/api\/skills(\/(content|toggle))?$/,
  new RegExp(`^/api/cron/jobs(/${SEG}(/(trigger|pause|resume))?)?$`),
  new RegExp(`^/api/messaging/platforms(/${SEG}(/test)?)?$`),
  new RegExp(`^/api/messaging/whatsapp/onboarding/${SEG}(/apply)?$`),
  /^\/api\/gateway\/restart$/,
  /^\/api\/hermes\/update(\/check)?$/,
  /^\/api\/actions\/hermes-update\/status$/,
  /^\/api\/model\/(recommended-default|set)$/,
  /^\/api\/providers\/validate$/,
  new RegExp(`^/api/providers/oauth(/sessions/${SEG}|/${SEG}/(start|poll/${SEG}))?$`),
  // Read-only local usage accounting for the support panel's usage row.
  /^\/api\/analytics\/usage$/,
  // Credential-pool STATUS for the same row's quota tier (per-entry last_status:
  // ok/exhausted/dead — Hermes' own quota verdict). The endpoint redacts secrets
  // server-side; the renderer only ever reads it (list route only — the
  // per-entry delete route has extra segments and stays blocked).
  /^\/api\/credentials\/pool$/
]

// Query keys the renderer actually sends (`withProfile`, provider/model lookup,
// skill content by name, update-check `force`, action-log `lines`, usage-window
// `days`). Unknown
// keys are rejected, not stripped — a request carrying an unexpected key is a
// bug or an attack, and silently altering it would hide either.
const API_QUERY_KEYS = new Set(['profile', 'provider', 'name', 'force', 'lines', 'days'])
const API_QUERY_VALUE = new RegExp(`^(${SEG})?$`)

/**
 * Validate a renderer-supplied `hermes:api` endpoint against the product's
 * route allow-list. Returns the endpoint unchanged when it is acceptable and
 * throws otherwise — the caller must not fall back to the raw argument.
 */
function assertAllowedApiEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || !endpoint || endpoint.length > API_MAX_ENDPOINT) {
    throw new Error('Hermes API endpoint must be a non-empty string')
  }
  // No whitespace/control characters (header or log injection), no backslash
  // (Windows-style traversal), no fragment (never produced by the facade).
  if (/[\s\\#]/.test(endpoint) || /[\u0000-\u001f\u007f]/.test(endpoint)) {
    throw new Error('Hermes API endpoint contains forbidden characters')
  }
  const queryIndex = endpoint.indexOf('?')
  const pathPart = queryIndex === -1 ? endpoint : endpoint.slice(0, queryIndex)
  const queryPart = queryIndex === -1 ? '' : endpoint.slice(queryIndex + 1)

  // Traversal defenses on the raw path: literal dot-dot and empty segments,
  // plus their percent-encoded spellings (the gateway decodes AFTER this check,
  // so `%2e%2e%2f` must be treated exactly like `../`).
  if (pathPart.includes('..') || pathPart.includes('//') || /%2e|%2f|%5c/i.test(pathPart)) {
    throw new Error('Hermes API endpoint contains a forbidden path sequence')
  }
  if (!ALLOWED_API_ROUTES.some(route => route.test(pathPart))) {
    throw new Error(`Hermes API endpoint is not allowed: ${pathPart}`)
  }
  if (queryPart) {
    for (const pair of queryPart.split('&')) {
      const eqIndex = pair.indexOf('=')
      const key = eqIndex === -1 ? pair : pair.slice(0, eqIndex)
      const value = eqIndex === -1 ? '' : pair.slice(eqIndex + 1)
      if (!API_QUERY_KEYS.has(key)) {
        throw new Error(`Hermes API query key is not allowed: ${key}`)
      }
      if (value.length > API_MAX_QUERY_VALUE || !API_QUERY_VALUE.test(value)) {
        throw new Error(`Hermes API query value is not allowed for key: ${key}`)
      }
    }
  }
  return endpoint
}

// Methods the facade actually uses. PATCH/HEAD/OPTIONS (or arbitrary verbs)
// are rejected rather than forwarded.
const API_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE'])

/**
 * Rebuild the renderer-supplied `init` for `hermes:api` from scratch, keeping
 * only `{method, body}`. `headers` is DELIBERATELY dropped: hermesApi spreads
 * `init.headers` over its authenticated header set, so forwarding it would let
 * the renderer override Authorization/Content-Type on the token-bearing fetch.
 * The body passes through untouched — it is user data addressed to an
 * allow-listed endpoint, and the gateway owns its validation.
 */
function sanitizeApiInit(init) {
  if (init === undefined || init === null) return {}
  if (typeof init !== 'object' || Array.isArray(init)) {
    throw new Error('Hermes API init must be an object')
  }
  const sanitized = {}
  if (init.method !== undefined) {
    const method = typeof init.method === 'string' ? init.method.toUpperCase() : ''
    if (!API_METHODS.has(method)) throw new Error('Hermes API method is not allowed')
    sanitized.method = method
  }
  if (init.body !== undefined) sanitized.body = init.body
  return sanitized
}

module.exports = {
  normalizeOpenFileFilters,
  createSerialGuard,
  assertAllowedApiEndpoint,
  sanitizeApiInit
}
