const { parseSemver, compareSemver } = require('./companion-update-core.cjs')

// PURE decisions for "return תכל'ס to the version it came from" (F5).
//
// ── Why a rollback needs its own module and not a boolean on the update path ──
// The forward updater's central security control is that the manifest must be
// STRICTLY NEWER than what is installed — an authentic-but-old manifest served by
// a hostile mirror is how a downgrade attack lands the user on a version whose
// hole is already patched. A rollback deliberately does the one thing that
// control exists to forbid, so it cannot be a flag threaded through the same
// decision; it needs its own, separately argued gate.
//
// The argument that makes it safe is this: the forward path's anti-replay anchor
// is `expectedVersion`, and it stays exactly as strong here — the manifest must
// still match it byte for byte. What changes is only WHERE that value comes from.
// For a rollback it is not "whatever the release feed offers"; it is read out of
// OUR OWN durable journal — the version this install recorded updating away from,
// written before the installer ever ran. So the destination is a fact about this
// machine's past, not a claim anyone on the network can influence. The worst an
// attacker who fully controls the feed can achieve is to serve the user the very
// version they were running an hour ago, which they are asking for by name.
//
// Consequences of that framing, all enforced below:
//   * exactly ONE step back is ever offered (the immediately previous version) —
//     there is no "pick a version" list, because every extra choice is a
//     destination an attacker did not have to earn;
//   * the recorded update must be about the version RUNNING RIGHT NOW, otherwise
//     the journal is describing some other install and proves nothing;
//   * the target must be strictly older, which also makes the offer disappear by
//     itself after a rollback completes (the archived entry then points forward).

/** Ordered reasons a rollback is not on offer. Callers branch on the code. */
const ROLLBACK_CODES = Object.freeze([
  'running-version-unparseable',
  'no-recorded-update',
  'target-version-unparseable',
  'target-not-older',
  'release-absent',
  'release-tag-unparseable'
])

/**
 * The archived journal outcomes that prove "this install arrived at the running
 * version by way of a companion update", and therefore that a previous version
 * genuinely ran on this machine.
 *
 *   'applied'           — the update landed AND both health proofs passed.
 *   'applied-unhealthy' — the update landed but health verification failed. The
 *                         forward path deliberately leaves that record ACTIVE
 *                         rather than archiving it (versioning.md §7.3), so this
 *                         value only reaches history when the rollback path
 *                         archives it on the way out (companion-rollback.cjs).
 *                         It is the single most important anchor there is: a
 *                         broken update is precisely when someone wants to go
 *                         back, and dropping it would make a FAILED rollback
 *                         attempt silently destroy the offer to retry.
 */
const ROLLBACK_ANCHOR_OUTCOMES = Object.freeze(['applied', 'applied-unhealthy'])

const ROLLBACK_MESSAGES = Object.freeze({
  'running-version-unparseable': 'לא ניתן לזהות את הגרסה הפועלת, ולכן אין אפשרות לחזור לגרסה קודמת.',
  'no-recorded-update': 'הגרסה הזו לא הותקנה דרך עדכון בלחיצה אחת, ולכן אין גרסה קודמת מתועדת לחזור אליה.',
  'target-version-unparseable': 'הגרסה הקודמת הרשומה אינה תקינה, ולכן לא ניתן לחזור אליה.',
  'target-not-older': 'הגרסה הקודמת הרשומה אינה ישנה יותר מהגרסה הפועלת; אין לאן לחזור.',
  'release-absent': 'הגרסה הקודמת אינה זמינה יותר להורדה.',
  'release-tag-unparseable': 'לא ניתן לזהות את תגית הגרסה הקודמת.'
})

function messageForRollbackCode(code) {
  return ROLLBACK_MESSAGES[code] || 'לא ניתן לחזור לגרסה הקודמת.'
}

function unavailable(code, detail) {
  return { available: false, code, detail, target: null, source: null, message: messageForRollbackCode(code) }
}

/**
 * Is a one-step rollback on offer, and to which version?
 *
 *   runningVersion : app.getVersion() — the version actually executing.
 *   journal        : the ACTIVE companion-update journal, or null.
 *   history        : the archived journal entries array, or null.
 *
 * Returns { available:false, code, detail, message } or
 *         { available:true, target, from, source }.
 *
 * Two candidate sources, in this priority:
 *
 *   'journal' — an ACTIVE record still in phase `applying` whose targetVersion
 *               is the running version. This is the `applied-unhealthy` state:
 *               the install landed but the health proofs failed, so the journal
 *               was deliberately NOT cleared (versioning.md §7.3). It is the
 *               single most important case for this feature — the user is
 *               looking at a broken app right now — which is why it is checked
 *               first rather than falling through to history.
 *   'history' — the newest archived entry with outcome `applied` whose
 *               targetVersion is the running version, i.e. a completed, healthy
 *               update that the user nonetheless wants to undo.
 *
 * Only the outcomes in ROLLBACK_ANCHOR_OUTCOMES qualify from history.
 * `apply-failed` never changed the running version, `cancelled`/`failed` describe
 * a download that never ran an installer, and `unexpected-version` explicitly
 * means we could not prove what happened — treating any of them as a rollback
 * anchor would let a stale record point the installer at a version this machine
 * may never have run.
 */
function decideRollbackTarget({ runningVersion = null, journal = null, history = null } = {}) {
  if (!parseSemver(runningVersion)) {
    return unavailable('running-version-unparseable', `running version ${JSON.stringify(runningVersion)} is not a strict SemVer`)
  }

  let candidate = null
  let source = null

  if (journal && typeof journal === 'object' && journal.phase === 'applying' && compareSemver(runningVersion, journal.targetVersion) === 0) {
    candidate = journal.currentVersion
    source = 'journal'
  }

  if (!candidate) {
    const entries = Array.isArray(history) ? history : []
    // Newest first: the most recent applied update is the only one whose
    // "previous version" is one step away from where we stand.
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i]
      if (!entry || typeof entry !== 'object') continue
      if (!ROLLBACK_ANCHOR_OUTCOMES.includes(entry.outcome)) continue
      if (compareSemver(runningVersion, entry.targetVersion) !== 0) continue
      candidate = entry.currentVersion
      source = 'history'
      break
    }
  }

  if (!candidate) {
    return unavailable('no-recorded-update', `no companion update with outcome ${ROLLBACK_ANCHOR_OUTCOMES.join('/')} records v${runningVersion} as its target`)
  }
  if (!parseSemver(candidate)) {
    return unavailable('target-version-unparseable', `recorded previous version ${JSON.stringify(candidate)} is not a strict SemVer`)
  }
  const cmp = compareSemver(candidate, runningVersion)
  // `cmp === null` cannot occur — both sides parsed above — but it is not treated
  // as an ordering either: only a proven "older" opens the path.
  if (cmp === null || cmp >= 0) {
    return unavailable('target-not-older', `recorded previous version v${candidate} is not strictly older than the running v${runningVersion}`)
  }
  return { available: true, target: candidate, from: runningVersion, source, code: null, detail: `rollback to v${candidate} recorded in the ${source}`, message: null }
}

/**
 * Find the published release for an exact rollback target among the releases the
 * check already fetched.
 *
 * Matching is by PARSED SemVer equality, not by string, so the tag convention
 * (`v0.4.0-alpha.8` vs `0.4.0-alpha.8`) is not hardcoded anywhere — the same
 * parser the forward check uses on `tag_name` decides. That is deliberate: an
 * assumed tag shape would be a second, silent source of truth about how a release
 * is named, and it would break exactly once, in the field.
 *
 * Returns { ok:true, release } or { ok:false, code, detail, message }.
 */
function selectRollbackRelease({ releases = null, target = null } = {}) {
  if (!parseSemver(target)) {
    return { ok: false, code: 'target-version-unparseable', detail: `rollback target ${JSON.stringify(target)} is not a strict SemVer`, message: messageForRollbackCode('target-version-unparseable') }
  }
  const list = Array.isArray(releases) ? releases : []
  let sawUnparseable = false
  for (const release of list) {
    if (!release || typeof release !== 'object') continue
    // A draft was never published; a release we can see but that is marked draft
    // is not a thing any user ever ran, so it is not a rollback destination.
    if (release.draft === true) continue
    const parsed = parseSemver(release.tag_name)
    if (!parsed) { sawUnparseable = true; continue }
    if (compareSemver(parsed.raw, target) === 0) return { ok: true, release }
  }
  // The distinction matters for the message the user reads: "it is gone" is a
  // different fact from "we could not read the tags", and only the first one is
  // actionable by re-downloading manually.
  const code = sawUnparseable && list.length ? 'release-tag-unparseable' : 'release-absent'
  return { ok: false, code, detail: `no published release matches rollback target v${target} among ${list.length} fetched releases`, message: messageForRollbackCode(code) }
}

module.exports = {
  ROLLBACK_CODES,
  ROLLBACK_ANCHOR_OUTCOMES,
  ROLLBACK_MESSAGES,
  messageForRollbackCode,
  decideRollbackTarget,
  selectRollbackRelease
}
