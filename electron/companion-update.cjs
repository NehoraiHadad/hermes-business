const fs = require('node:fs')
const path = require('node:path')
const { safeWrite } = require('./atomic-write.cjs')
const { createSerialGuard } = require('./ipc-guards.cjs')
const { rememberLog } = require('./logs.cjs')
const { getQaRuntimeOverride } = require('./qa-runtime.cjs')
const {
  selectEligibleRelease,
  decideVerdict,
  sanitizeReleaseNotes,
  sanitizeDownloadUrl
} = require('./companion-update-core.cjs')

// Impure wiring for the תכל'ס (companion) self-update CHECK — the ONLY module
// that talks to the network for this feature. Decisions (semver, verdict,
// sanitizing) all live in the pure companion-update-core.cjs; this module owns
// fetch, the serial guard, the in-memory + durable throttle, and the exact
// GitHub request shape (docs/specs/versioning.md §6.1).
//
// This is a self-update CHECK ONLY (see D4/§10): it never downloads or installs
// a binary. The renderer never talks to api.github.com directly (D5) — this
// module is main-process-only and, once wired in stage 3, is the sole thing
// `hermes:companion-update` (IPC) calls into.

const RELEASES_URL = 'https://api.github.com/repos/NehoraiHadad/hermes-business/releases?per_page=20'
const REQUEST_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const BUSY_MESSAGE = 'בדיקת עדכון כבר מתבצעת'
const UNKNOWN_MESSAGE = 'לא ניתן לבדוק עדכונים כרגע'
const STATE_FILE_NAME = 'companion-update-state.json'

// electron is required LAZILY (inside the default-dep functions below, never at
// module load) so this module stays importable — and its pure-ish helpers
// (isPassiveUpdateCheckDisabled) stay callable — from vitest without a live
// Electron runtime. Real callers (main process) get the real app; tests inject
// `getVersion`/`stateDir` directly.
function electronApp() {
  return require('electron').app
}

function defaultGetVersion() {
  return electronApp().getVersion()
}

function defaultStateDir() {
  return electronApp().getPath('userData')
}

function statePath(dir) {
  return path.join(dir, STATE_FILE_NAME)
}

function readState(dir) {
  try {
    return JSON.parse(fs.readFileSync(statePath(dir), 'utf8'))
  } catch {
    return null
  }
}

// Best-effort: throttle/cache bookkeeping must never fail the check itself —
// a write failure here degrades to "no durable memory of the last check", not
// a broken update check.
function writeState(dir, state) {
  try {
    safeWrite(statePath(dir), JSON.stringify(state, null, 2))
  } catch (error) {
    rememberLog(`Companion update state write failed (non-fatal): ${error.message || error}`)
  }
}

/**
 * Whether a PASSIVE (startup-timer) update check must stay hermetic: the QA
 * runtime override (qa-runtime.cjs sentinel) is active, or the isolated E2E env
 * flag TACHLES_DISABLE_UPDATE_CHECK=1 is set. Built and unit-tested now so a
 * later passive-timer caller (stage 3, out of scope here) has a single source
 * of truth to consult BEFORE ever invoking `checkCompanionUpdate`; this
 * function performs no network I/O itself. A malformed/invalid QA override
 * environment fails CLOSED (treated as disabled) rather than risking a network
 * call from what might be a misconfigured isolated harness.
 *
 * The explicit, user-initiated check (the support-screen button) is NEVER
 * gated by this — it is a deliberate user action, not the passive timer (see
 * docs/specs/versioning.md §6.5), so its caller must not consult this helper.
 */
function isPassiveUpdateCheckDisabled(env = process.env) {
  if (env.TACHLES_DISABLE_UPDATE_CHECK === '1') return true
  try {
    return getQaRuntimeOverride(env).enabled === true
  } catch {
    return true
  }
}

function unknownVerdict(current, checkedAt, message = UNKNOWN_MESSAGE) {
  return { status: 'unknown', current, checkedAt, message }
}

/**
 * Read the durable last-successful-check timestamp (companion-update-state.json)
 * WITHOUT performing any network I/O. Consulted by the passive startup timer
 * (main.cjs, §6.5) to decide whether 24h have passed BEFORE ever calling
 * `checkCompanionUpdate` — the passive path stays a pure local read when there is
 * nothing to do, never touching the network just to find that out. Returns
 * `null` when no state file exists yet, it is unreadable, or no stateDir is
 * available — a missing/corrupt file is not proof a check ran recently, so the
 * caller ends up (correctly) treating it as "due for a check", not skipping one.
 */
function getLastCheckedAt(deps = {}) {
  const { stateDir = defaultStateDir } = deps
  const dir = stateDir()
  if (!dir) return null
  const state = readState(dir)
  return state && typeof state.lastCheckedAt === 'number' ? state.lastCheckedAt : null
}

async function fetchReleases(fetchImpl) {
  const response = await fetchImpl(RELEASES_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      // No app version in the User-Agent — minimize information leakage (§9).
      'User-Agent': 'tachles-companion'
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!response || response.ok !== true) {
    const status = response ? response.status : 'no-response'
    throw new Error(`GitHub releases request failed: HTTP ${status}`)
  }
  const payload = await response.json()
  if (!Array.isArray(payload)) throw new Error('GitHub releases payload is not an array')
  return payload
}

// Build the scalar verdict from a proven decision + the winning raw release.
// Only scalars ever cross into the verdict — nothing from the raw GitHub
// response is forwarded as-is (§6.2: "no raw object from the GitHub response
// crosses the IPC boundary").
function buildAvailableVerdict(current, checkedAt, release) {
  const verdict = {
    status: 'update-available',
    current,
    latest: typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/, '') : undefined,
    checkedAt
  }
  if (typeof release.name === 'string') verdict.releaseName = release.name.slice(0, 200)
  const notes = sanitizeReleaseNotes(release.body)
  if (notes) verdict.notes = notes
  const downloadUrl = sanitizeDownloadUrl(release.html_url)
  if (downloadUrl) verdict.downloadUrl = downloadUrl
  if (typeof release.published_at === 'string') verdict.publishedAt = release.published_at
  return verdict
}

const runExclusive = createSerialGuard(BUSY_MESSAGE)
// In-memory cache: { verdict, checkedAt }. Cleared implicitly on process
// restart — the DURABLE throttle bookkeeping (companion-update-state.json)
// is separate and is what a future passive-timer caller (stage 3) will read
// to decide whether 24h have passed since the last check.
let memoryCache = null

/**
 * Run (or serve from cache) a companion self-update check. `force` bypasses
 * the 6h in-memory cache. Every collaborator is injectable via the second
 * `deps` argument (same DI shape as `assertReleaseReachable` in
 * hermes-update-preflight.cjs / the fixtures pattern in
 * hermes-update-flow.test.ts) so this is fully testable without Electron or a
 * live network.
 *
 * Fail-closed contract (docs/specs/versioning.md §8): this function NEVER
 * rejects. Any failure — offline/timeout, non-200, malformed JSON, no
 * parseable release tag, an empty release list, or a concurrent in-flight
 * check — resolves to `{ status: 'unknown', ... }`. `up-to-date` is returned
 * ONLY on a complete positive proof (see companion-update-core.decideVerdict).
 */
async function checkCompanionUpdate({ force = false } = {}, deps = {}) {
  const {
    fetch: fetchImpl = fetch,
    getVersion = defaultGetVersion,
    stateDir = defaultStateDir,
    now = () => Date.now()
  } = deps

  const current = getVersion()

  try {
    return await runExclusive(async () => {
      if (!force && memoryCache && now() - memoryCache.checkedAt < CACHE_TTL_MS) {
        return memoryCache.verdict
      }

      let releases
      try {
        releases = await fetchReleases(fetchImpl)
      } catch (error) {
        rememberLog(`Companion update check failed (network/parse): ${error.message || error}`)
        return unknownVerdict(current, now())
      }

      let eligible
      let decision
      try {
        eligible = selectEligibleRelease(releases, current)
        decision = decideVerdict(current, eligible)
      } catch (error) {
        rememberLog(`Companion update check failed (decision): ${error.message || error}`)
        return unknownVerdict(current, now())
      }

      const checkedAt = now()
      let verdict
      if (decision.status === 'update-available') {
        verdict = buildAvailableVerdict(current, checkedAt, decision.release)
      } else if (decision.status === 'unknown') {
        // No eligible release found (empty/all-filtered list) or an unparseable
        // current version — a fetch that succeeded but proved nothing still
        // carries the same user-facing "can't check right now" copy as a
        // network/parse failure (§7.1, §8).
        verdict = unknownVerdict(current, checkedAt)
      } else {
        verdict = { status: decision.status, current, checkedAt }
      }

      memoryCache = { verdict, checkedAt }
      const dir = stateDir()
      if (dir) {
        writeState(dir, { ...(readState(dir) || {}), lastCheckedAt: checkedAt, lastStatus: verdict.status })
      }
      return verdict
    })
  } catch (error) {
    // The serial guard's busy rejection (a concurrent check already running)
    // and any other unforeseen throw both land here — resolved, never
    // rethrown, per the fail-closed contract above. A busy rejection reports
    // its own user-facing message verbatim; anything else reports the generic
    // "can't check right now" copy.
    const message = error && error.message === BUSY_MESSAGE ? BUSY_MESSAGE : UNKNOWN_MESSAGE
    // A busy rejection must not erase the last successful check's timestamp —
    // "a check is already running" is not "never checked".
    return unknownVerdict(current, memoryCache ? memoryCache.checkedAt : null, message)
  }
}

// Test-only: drop the in-memory 6h cache so a suite can exercise a clean
// module state between cases without process-restart-only isolation. Same
// idiom as qa-runtime.cjs's __resetQaRuntimeOverrideCache. Never called in
// production.
function __resetCompanionUpdateCacheForTests() {
  memoryCache = null
}

module.exports = {
  RELEASES_URL,
  REQUEST_TIMEOUT_MS,
  CACHE_TTL_MS,
  STATE_FILE_NAME,
  checkCompanionUpdate,
  isPassiveUpdateCheckDisabled,
  getLastCheckedAt,
  __resetCompanionUpdateCacheForTests
}
