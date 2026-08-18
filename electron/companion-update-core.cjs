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
 * Scan a raw GitHub releases listing (see §6.1) and report BOTH the winning
 * candidate and how trustworthy the scan itself was.
 *
 * Returns `{ eligible, examined, undecided }`:
 *   - `eligible`  — the highest eligible raw release object, or `null`.
 *   - `examined`  — how many entries the scan actually looked at. A census of
 *     ZERO entries is not the same fact as a census that was read and found to
 *     hold nothing newer; `decideVerdict` keeps them apart (see there).
 *   - `undecided` — how many entries could NOT be ordered against
 *     `currentVersion` at all. This is the difference that matters for the
 *     fail-closed semantics: an entry may be left out of the running for two
 *     very different reasons.
 *
 * DECISIVE exclusions (do NOT count as undecided — we know they can never be an
 * available update):
 *   - `draft: true` — not published at all, so it cannot be offered to anyone,
 *     whatever its tag says.
 *   - `prerelease: true` while `currentVersion` is stable — excluded by CHANNEL
 *     POLICY (D1), not by ignorance: a stable install is deliberately not
 *     offered alphas. An alpha/beta install compares against everything, so it
 *     sees both the next prerelease AND the stable release that closes it.
 *
 * UNDECIDED exclusions (counted, because they might well be something newer we
 * simply could not read):
 *   - a non-object entry — the payload is not shaped like a release listing.
 *   - an unparseable `tag_name` on a real, published, in-channel release — it
 *     is skipped (never a failure, per §6.1) but we cannot claim it is older
 *     than the running version. `decideVerdict` refuses to call such a scan
 *     complete, which is exactly why "all tags unparseable" stays `unknown`.
 */
function scanReleases(releases, currentVersion) {
  if (!Array.isArray(releases)) return { eligible: null, examined: 0, undecided: 0 }
  const current = parseSemver(currentVersion)
  const currentIsStable = Boolean(current) && current.prerelease.length === 0

  let best = null
  let bestParsed = null
  let undecided = 0
  for (const release of releases) {
    if (!release || typeof release !== 'object') {
      undecided += 1
      continue
    }
    if (release.draft === true) continue
    // Policy exclusion is evaluated BEFORE parsing: a prerelease an install can
    // never be offered is decisively out of the running even if its tag is
    // garbage, so it must not poison the completeness of the scan.
    if (release.prerelease === true && currentIsStable) continue
    const parsed = parseSemver(release.tag_name)
    if (!parsed) {
      undecided += 1
      continue
    }
    if (!best || compareSemver(parsed, bestParsed) > 0) {
      best = release
      bestParsed = parsed
    }
  }
  return { eligible: best, examined: releases.length, undecided }
}

/**
 * Select the highest ELIGIBLE release out of a raw GitHub releases listing —
 * the candidate half of `scanReleases`, kept as its own named export because
 * "which release wins" is a question worth asking (and testing) on its own.
 * Returns the winning raw release object, or `null` when nothing is eligible
 * (empty list, all drafts, all unparseable).
 */
function selectEligibleRelease(releases, currentVersion) {
  return scanReleases(releases, currentVersion).eligible
}

/**
 * Does a GitHub `Link` response header advertise a NEXT page? (RFC 8288.) This
 * is the only completeness signal the check has: the request asks for
 * `per_page=20`, so "no eligible release among the results" is a COMPLETE proof
 * only when there is no further page to look at.
 *
 * Pure on purpose — the impure layer merely READS the header off the response;
 * what its value means is a decision, and decisions live here.
 *
 * Parsing is deliberately narrow and tolerant: the value is split into
 * `<uri>; params` segments, and only the params half of each segment is
 * examined, so a `rel="next"` substring appearing INSIDE a URI can never be
 * mistaken for a real relation. Both the quoted (`rel="next"`, possibly a
 * space-separated list such as `rel="prev next"`) and bare (`rel=next`) forms
 * are recognised. Anything unrecognised returns `false` — and the CALLER treats
 * an unreadable/absent header as incomplete, so a `false` here never becomes an
 * unearned completeness claim on its own.
 */
function linkHeaderHasNextPage(value) {
  if (typeof value !== 'string' || value.trim() === '') return false
  for (const segment of value.split(',')) {
    const uriEnd = segment.indexOf('>')
    if (uriEnd < 0) continue
    const params = segment.slice(uriEnd + 1)
    if (/(?:^|;)\s*rel\s*=\s*(?:"[^"]*\bnext\b[^"]*"|'[^']*\bnext\b[^']*'|next)\s*(?:;|$)/i.test(params)) {
      return true
    }
  }
  return false
}

/**
 * Is a scan a COMPLETE census of everything published? Requires positive proof
 * on both axes, and a missing field is never proof:
 *   - `truncated === false` — the response explicitly carried no next-page link
 *     (and the header was readable at all).
 *   - `undecided === 0`     — every published, in-channel entry was orderable.
 *
 * Deliberately says NOTHING about the census being non-empty: an empty listing
 * is perfectly complete (we saw all zero of its entries). Whether zero entries
 * can support a verdict is a separate question, answered in `decideVerdict`.
 */
function isCompleteScan(scan) {
  if (!scan || typeof scan !== 'object') return false
  return scan.truncated === false && scan.undecided === 0
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
 * consulting this function). `eligible` is the release `scanReleases` chose (or
 * `null`); `scan` carries the facts about the scan itself:
 * `{ truncated, undecided }` (see `isCompleteScan`).
 *
 * Returns `{ status, release? }`:
 *   - `update-available` — the eligible release is newer than `current` (proven
 *     positively; `release` carries the winning raw release object).
 *   - `up-to-date`        — either `current` equals the eligible release
 *     exactly, OR a COMPLETE and NON-EMPTY scan found no eligible candidate.
 *   - `dev-ahead`         — `current` is newer than anything eligible published.
 *   - `unknown`           — every other, unproven branch: `current` itself is
 *     unparseable, or no eligible candidate was found by an INCOMPLETE scan, or
 *     the census was EMPTY.
 *
 * `up-to-date` is still NEVER a soft default (§8) — but the three cases the
 * no-candidate branch used to conflate are now separated, because they are not
 * the same claim:
 *
 *   1. A COMPLETE scan of a NON-EMPTY census that found no eligible candidate is
 *      a positive proof of the only thing `up-to-date`/`מעודכן` actually
 *      asserts to the user: "nothing newer than what you run is published for
 *      you". A stable install when every published release is a prerelease is
 *      exactly this case — the fetch fully succeeded, a real census was read,
 *      and it definitively proved there is nothing to install. Reporting
 *      `unknown` there ("לא ניתן לבדוק עדכונים כרגע") would be a LIE about
 *      the check having failed, which is its own fail-open in the other
 *      direction: it hides a proven-good state behind a fake error.
 *   2. An INCOMPLETE scan that found no eligible candidate proves nothing: the
 *      unexamined remainder may hold the very release we were looking for.
 *      Stays `unknown`.
 *   3. An EMPTY census (`examined === 0`) is CONTENT-FREE, and reading
 *      reassurance into content-free data is exactly the fake-"מעודכן" the
 *      spec's §1.4 doctrine violation was about. This repo has published
 *      releases and a never-shrinking ledger (scripts/lib/release/prior-ledger.mjs),
 *      so `[]` is an ANOMALY — an upstream incident, a proxy, a misconfigured
 *      mirror — not the honest steady state "nothing has shipped yet". Between
 *      `up-to-date` (durable: cached and written to `lastStatus`, and it
 *      silently swallows a pending update) and `unknown` (recoverable: "couldn't
 *      check"), fail-closed for a security-relevant update channel means
 *      `unknown`. The one legitimately-empty state — before the very first
 *      release exists — belongs to a developer running an unpublished build, for
 *      whom "inconclusive" is no less truthful than "מעודכן". Note this is a
 *      NON-EMPTINESS test, not a completeness test: an empty census is perfectly
 *      complete (we saw all zero of its entries), which is why it lives here and
 *      not inside `isCompleteScan`.
 *
 * Truncation and a FOUND candidate: GitHub returns releases newest-CREATED
 * first, so anything a truncated page omits was created BEFORE everything we
 * saw. Combined with this repo's strictly monotonic version doctrine (§5.2 bump
 * rules + the no-reuse ledger, §1.3), the omitted tail is strictly older than
 * the page we did read — so a comparison anchored on a REAL release found in
 * that page stays decisive under truncation, for all three of
 * `update-available` / `up-to-date` / `dev-ahead`. `update-available` is safe
 * even without the monotonicity argument: something newer demonstrably exists,
 * and older omitted entries cannot unmake that. With NO candidate there is no
 * anchor at all, which is precisely why that branch — and only that branch —
 * demands a complete scan.
 */
function decideVerdict(current, eligible, scan) {
  const parsedCurrent = parseSemver(current)
  if (!parsedCurrent) return { status: STATUSES.UNKNOWN }
  if (!eligible) {
    const provenEmptyOfNewer = isCompleteScan(scan) && scan.examined > 0
    return provenEmptyOfNewer ? { status: STATUSES.UP_TO_DATE } : { status: STATUSES.UNKNOWN }
  }
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
  scanReleases,
  selectEligibleRelease,
  linkHeaderHasNextPage,
  isCompleteScan,
  decideVerdict,
  sanitizeReleaseNotes,
  sanitizeDownloadUrl
}
