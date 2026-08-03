// Pure decision layer for the תכל'ס (companion) self-update CHECK — parsing,
// semver ordering, release selection, verdict, and untrusted-content sanitizing.
// No Electron, no network, no filesystem: every branch of the fail-closed
// semantics table (docs/specs/versioning.md §8) is a pure function of its inputs,
// so it is fully unit-testable without a live GitHub API. The impure wiring
// (fetch, cache, throttle, IPC) lives in companion-update.cjs.
//
// Companion self-update is NOT electron-updater (see §10): this module only
// decides whether a newer companion release exists, never mutates anything.

// Strict SemVer 2.0.0 (with an optional leading `v`, matching a git tag like
// `v0.4.0-alpha.1`). Anything else — build metadata (`+...`), a malformed tag, a
// non-string — is unparseable and returns null. Never throws.
// Numeric parts forbid leading zeros (`0|[1-9]\d*`), per SemVer §2/§9 — both in
// the core triple and in numeric prerelease identifiers (`01` is illegal, but
// `alpha-01`-style alphanumerics are fine because they compare lexically).
const NUM = '(?:0|[1-9]\\d*)'
const PRERELEASE_ID = `(?:${NUM}|\\d*[A-Za-z-][0-9A-Za-z-]*)`
const SEMVER_RE = new RegExp(`^v?(${NUM})\\.(${NUM})\\.(${NUM})(-${PRERELEASE_ID}(?:\\.${PRERELEASE_ID})*)?$`)

/**
 * Parse a version string strictly. Returns
 * `{ major, minor, patch, prerelease: string[], raw }` or `null`. `prerelease`
 * is the dash-suffix split on `.` (e.g. `-alpha.9` → `['alpha', '9']`), `[]` for
 * a stable version.
 */
function parseSemver(text) {
  if (typeof text !== 'string') return null
  const m = SEMVER_RE.exec(text.trim())
  if (!m) return null
  const [, major, minor, patch, prereleaseSuffix] = m
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prereleaseSuffix ? prereleaseSuffix.slice(1).split('.') : [],
    raw: text.trim()
  }
}

// One SemVer 2.0.0 prerelease identifier comparison (spec §11.4.4): identifiers
// consisting only of digits are compared numerically; any other identifier is
// compared lexically (ASCII); a purely-numeric identifier always has lower
// precedence than an alphanumeric one.
function compareIdentifiers(a, b) {
  const aNumeric = /^\d+$/.test(a)
  const bNumeric = /^\d+$/.test(b)
  if (aNumeric && bNumeric) {
    const an = Number(a)
    const bn = Number(b)
    return an === bn ? 0 : an < bn ? -1 : 1
  }
  if (aNumeric) return -1
  if (bNumeric) return 1
  if (a === b) return 0
  return a < b ? -1 : 1
}

// Full prerelease precedence: a version WITHOUT a prerelease is always greater
// than one WITH a prerelease (a stable release outranks any alpha/beta of the
// same major.minor.patch). When both carry a prerelease, identifiers are
// compared left-to-right; if all shared identifiers are equal, the longer list
// wins (0.4.0-alpha.1.1 > 0.4.0-alpha.1).
function comparePrerelease(a, b) {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    if (i >= a.length) return -1
    if (i >= b.length) return 1
    const c = compareIdentifiers(a[i], b[i])
    if (c !== 0) return c
  }
  return 0
}

/**
 * Full SemVer 2.0.0 ordering, including numeric prerelease identifiers. Accepts
 * either raw version strings or already-parsed objects (from `parseSemver`).
 * Returns -1 / 0 / 1, or `null` if either side is unparseable (comparison is
 * undefined, not "equal" — callers must treat null as "cannot prove an order").
 * No npm dependency (`semver` package) — this is the repo's own small,
 * fully-tested implementation, matching the dependency discipline the rest of
 * the release tooling already follows.
 */
function compareSemver(a, b) {
  const pa = typeof a === 'string' ? parseSemver(a) : a
  const pb = typeof b === 'string' ? parseSemver(b) : b
  if (!pa || !pb) return null
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1
  return comparePrerelease(pa.prerelease, pb.prerelease)
}

/**
 * Select the highest ELIGIBLE release out of a raw GitHub releases listing (see
 * §6.1). Eligibility: not a draft; not a prerelease when `currentVersion` is
 * itself stable (an alpha/beta install compares against everything, so it can
 * see both the next prerelease AND the stable release that closes it — D1); a
 * `tag_name` that parses as SemVer. A release with an unparseable tag is
 * SKIPPED, never causes a failure. Returns the winning raw release object, or
 * `null` when nothing is eligible (empty list, all drafts, all unparseable).
 */
function selectEligibleRelease(releases, currentVersion) {
  if (!Array.isArray(releases)) return null
  const current = parseSemver(currentVersion)
  const currentIsStable = Boolean(current) && current.prerelease.length === 0

  let best = null
  let bestParsed = null
  for (const release of releases) {
    if (!release || typeof release !== 'object') continue
    if (release.draft === true) continue
    const parsed = parseSemver(release.tag_name)
    if (!parsed) continue
    if (release.prerelease === true && currentIsStable) continue
    if (!best || compareSemver(parsed, bestParsed) > 0) {
      best = release
      bestParsed = parsed
    }
  }
  return best
}

// The only four verdict statuses the companion self-update check ever reports.
const STATUSES = Object.freeze({
  UPDATE_AVAILABLE: 'update-available',
  UP_TO_DATE: 'up-to-date',
  DEV_AHEAD: 'dev-ahead',
  UNKNOWN: 'unknown'
})

/**
 * Decide the verdict from an ALREADY-SUCCESSFUL fetch (the caller must not call
 * this on a network/parse failure — those resolve to `unknown` directly without
 * consulting this function). `eligible` is the release `selectEligibleRelease`
 * chose (or `null`).
 *
 * Returns `{ status, release? }`:
 *   - `update-available` — the eligible release is newer than `current` (proven
 *     positively; `release` carries the winning raw release object).
 *   - `up-to-date`        — `current` equals the eligible release exactly.
 *   - `dev-ahead`         — `current` is newer than anything eligible published.
 *   - `unknown`           — every other, unproven branch: `current` itself is
 *     unparseable, or no eligible release was found (empty/all-filtered list).
 *
 * `up-to-date` is NEVER the default — it requires a complete positive proof
 * (current version parses AND an eligible release exists AND they compare
 * equal). Anything ambiguous falls through to `unknown`.
 */
function decideVerdict(current, eligible) {
  const parsedCurrent = parseSemver(current)
  if (!parsedCurrent) return { status: STATUSES.UNKNOWN }
  if (!eligible) return { status: STATUSES.UNKNOWN }
  const parsedEligible = parseSemver(eligible.tag_name)
  if (!parsedEligible) return { status: STATUSES.UNKNOWN }

  const cmp = compareSemver(parsedEligible, parsedCurrent)
  if (cmp === null) return { status: STATUSES.UNKNOWN }
  if (cmp > 0) return { status: STATUSES.UPDATE_AVAILABLE, release: eligible }
  if (cmp < 0) return { status: STATUSES.DEV_AHEAD }
  return { status: STATUSES.UP_TO_DATE }
}

const NOTES_MAX_LENGTH = 600

// Control characters to strip from release notes, EXCLUDING tab (9) and
// newline (10) so multi-line/formatted text stays readable as PLAIN TEXT --
// never rendered as markdown/HTML, never parsed as instructions (see 6.1 and
// R3). Expressed via char codes rather than a regex literal (C0 controls 0-31
// other than tab/newline, plus DEL 127) to keep the source file unambiguous.
function isStrippedNotesCharCode(code) {
  if (code === 9 || code === 10) return false
  if (code >= 0 && code <= 31) return true
  if (code === 127) return true
  // Unicode bidi controls: in an RTL Hebrew UI an attacker-controlled release
  // body could use RLO/LRO/isolates to visually reorder the rendered text and
  // spoof the warning copy around it. Legitimate release notes never need
  // explicit bidi controls (plain Hebrew/English reorders correctly on its
  // own), so all of them are stripped:
  //   U+061C ALM, U+200E LRM, U+200F RLM, U+202A-U+202E (LRE/RLE/PDF/LRO/RLO),
  //   U+2066-U+2069 (LRI/RLI/FSI/PDI).
  if (code === 0x061c || code === 0x200e || code === 0x200f) return true
  if (code >= 0x202a && code <= 0x202e) return true
  return code >= 0x2066 && code <= 0x2069
}

/**
 * Sanitize a GitHub release `body` for display. Release-note content is
 * UNTRUSTED DATA (R3, prompt-injection surface): the result is plain text
 * only -- control characters stripped, capped at 600 characters -- and must
 * never be interpreted as markdown/HTML or as instructions by any downstream
 * logic. Any URL embedded in the text is never extracted/opened by this
 * function; the only link the product opens is the separately-validated
 * `html_url` (see `sanitizeDownloadUrl`). Non-string input returns `''`.
 */
function sanitizeReleaseNotes(body) {
  if (typeof body !== 'string') return ''
  let out = ''
  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i)
    if (!isStrippedNotesCharCode(code)) out += body[i]
  }
  const trimmed = out.trim()
  return trimmed.length > NOTES_MAX_LENGTH ? trimmed.slice(0, NOTES_MAX_LENGTH) : trimmed
}

// The only prefix a companion download link is ever allowed to carry (§6.3).
const DOWNLOAD_URL_PREFIX = 'https://github.com/NehoraiHadad/hermes-business/releases/'

/**
 * Validate a candidate download URL (a release's `html_url`) against the exact
 * required prefix. Returns the URL unchanged when it starts with
 * `https://github.com/NehoraiHadad/hermes-business/releases/`, or `null`
 * otherwise — including a look-alike host such as
 * `https://github.com.evil.tld/...` (a DIFFERENT origin: `startsWith` anchors at
 * position 0, so the literal path `github.com/` must appear verbatim right after
 * the scheme; `github.com.evil.tld` never matches it). A rejected URL is
 * OMITTED from the verdict, never substituted with something else — the UI
 * falls back to a manual pointer at the Releases page.
 */
function sanitizeDownloadUrl(url) {
  return typeof url === 'string' && url.startsWith(DOWNLOAD_URL_PREFIX) ? url : null
}

module.exports = {
  SEMVER_RE,
  STATUSES,
  DOWNLOAD_URL_PREFIX,
  parseSemver,
  compareSemver,
  selectEligibleRelease,
  decideVerdict,
  sanitizeReleaseNotes,
  sanitizeDownloadUrl
}
