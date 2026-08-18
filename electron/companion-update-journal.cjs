const fs = require('node:fs')
const path = require('node:path')
const { hermesHome } = require('./paths.cjs')
const { safeWrite } = require('./atomic-write.cjs')
const { rememberLog } = require('./logs.cjs')
const { parseSemver } = require('./companion-update-core.cjs')

// Durable journal + TRUST GATE for the in-app one-click update of תכל'ס ITSELF
// (the companion/Electron app), i.e. the download → verify → ready → apply
// lifecycle of an NSIS installer we hand to Windows.
//
// ── Why this is a SIBLING of update-journal-store.cjs and NOT a reuse of it ──
// A future reader will notice the two files share their atomic/history/verifiable
// -clear mechanics and be tempted to "helpfully" dedupe them. Do not. They
// journal two DIFFERENT transactions with disjoint state machines:
//   * update-journal-store.cjs journals the HERMES AGENT git update. Its PHASES
//     (preflight/stopping/backup/mutating/recovering/verifying), its
//     RECOVERABLE_METHODS (`git` only) and its ANCHOR_PATTERN (a git sha, the
//     destructive `git reset` target) are all meaningless here — a companion
//     update has no checkout, no anchor and no rollback-by-reset.
//   * THIS module journals an installer handoff. Its trusted fields are a
//     filesystem PATH we may later launch/delete and a SHA-256 digest we
//     re-verify immediately before launch. Its fail-closed obligations are
//     therefore about never launching/deleting an arbitrary path named by a
//     corrupt file — a completely different threat than "never reset to an
//     arbitrary commit".
// The only thing genuinely shared is the atomic-write primitive, which IS
// reused (safeWrite from atomic-write.cjs). Merging the state machines would
// force one union type to carry both sets of invariants and would make each
// validator weaker than it is now.
//
// It lives under <hermesHome>/business-state — the same durable, product-owned
// state dir the agent journal uses, so it honours the QA runtime override via
// hermesHome() and never lands inside the app install dir that the installer
// itself replaces (writing it there would let the update delete its own record).
// It records ONLY non-secret operational metadata: versions, the installer PATH
// (not its bytes), its expected digest, phase and timestamps.

const JOURNAL_VERSION = 1
const MAX_HISTORY = 20

// Phases, in order. There is no terminal phase: a completed lifecycle REMOVES
// the journal (verifiably), so any surviving record means the last companion
// update did not finish and launch-time recovery must decide what happened.
//   downloading — bytes are being fetched to installerPath (nothing installed).
//   verifying   — bytes are on disk, digest/signature checks in progress.
//   ready       — verified installer on disk, NOT yet launched (user consent
//                 pending). Still a zero-mutation state.
//   applying    — the installer WAS launched. This is the only phase in which
//                 the machine may already have been mutated, and the only one
//                 whose resolution needs the running app version.
const PHASES = Object.freeze(['downloading', 'verifying', 'ready', 'applying'])

// Exactly 64 LOWERCASE hex characters — the same shape the release-side manifest
// validator enforces (scripts/lib/release/update-manifest.mjs SHA256_HEX), so a
// digest that is accepted there cannot be rejected here or vice versa. Case is
// not normalised on purpose: a digest that arrives upper-case did not come from
// our own pipeline, and guessing is how a mismatch becomes a silent pass.
const SHA256_HEX = /^[0-9a-f]{64}$/

function stateDir(home = hermesHome()) {
  return path.join(home, 'business-state')
}
function journalPath(home = hermesHome()) {
  return path.join(stateDir(home), 'companion-update-journal.json')
}
function historyPath(home = hermesHome()) {
  return path.join(stateDir(home), 'companion-update-journal-history.json')
}

function nowIso() {
  return new Date().toISOString()
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function readCompanionJournal({ file = journalPath() } = {}) {
  return readJson(file)
}

// Force the record all the way to the platter, not just into the page cache.
// safeWrite's temp+rename is ATOMIC (no half-written record can ever be read)
// but atomicity is not durability: the rename can still be sitting in the OS
// cache when the installer kills this process a few milliseconds later. The
// apply path REQUIRES durability — an unjournalled `applying` is an update that
// nothing can reconcile at the next launch — so the file handle is fsync'd, and
// then (best-effort) the containing directory so the rename itself is durable.
// Windows rejects fsync on a directory handle, hence the swallow: the file
// fsync is the contract, the directory fsync is a POSIX bonus.
//
// The file handle is opened 'r+' (read/WRITE), not 'r': Windows implements
// fsync as FlushFileBuffers, which requires GENERIC_WRITE on the handle and
// fails with EPERM on a read-only one (observed here, not theorised). A silently
// EPERM-ing fsync would have made "durable" a lie on the exact platform this
// updater ships to.
function fsyncPath(file) {
  const fd = fs.openSync(file, 'r+')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  try {
    const dirFd = fs.openSync(path.dirname(file), 'r')
    try {
      fs.fsyncSync(dirFd)
    } finally {
      fs.closeSync(dirFd)
    }
  } catch {
    /* directory fsync is unsupported on Windows; the file fsync above is the contract */
  }
}

function writeRecord(file, record, { durable = false, sync = fsyncPath } = {}) {
  safeWrite(file, JSON.stringify(record, null, 2))
  if (durable) sync(file)
  return record
}

/**
 * Open a companion-update record BEFORE the first byte is downloaded. Overwrites
 * any stale journal atomically — a previous incomplete lifecycle is resolved by
 * launch-time recovery, never by a half-open second journal.
 *
 * All four trusted fields are known up front (the target version and its
 * expected digest come from the signed update manifest; installerPath is the
 * destination we chose), so validation can demand them in EVERY phase rather
 * than having a "not filled in yet" hole an attacker could aim at.
 */
function beginCompanionUpdate(
  { currentVersion, targetVersion, installerPath, installerSha256 } = {},
  { file = journalPath(), now = nowIso, durable = false, sync = fsyncPath } = {}
) {
  const stamp = now()
  const record = {
    journalVersion: JOURNAL_VERSION,
    phase: 'downloading',
    currentVersion: currentVersion || null,
    targetVersion: targetVersion || null,
    installerPath: installerPath || null,
    installerSha256: installerSha256 || null,
    startedAt: stamp,
    updatedAt: stamp,
    failures: []
  }
  return writeRecord(file, record, { durable, sync })
}

/**
 * Advance the phase and merge a shallow patch. No-op-safe: a vanished journal is
 * NOT recreated (recovery decides what a missing record means).
 *
 * `durable: true` additionally fsyncs — the apply path passes it, because the
 * very next thing that happens is a process that kills us.
 */
function updateCompanionPhase(
  phase,
  patch = {},
  { file = journalPath(), now = nowIso, durable = false, sync = fsyncPath } = {}
) {
  const current = readCompanionJournal({ file })
  if (!current) return null
  const record = { ...current, ...patch, phase, updatedAt: now() }
  return writeRecord(file, record, { durable, sync })
}

// Append a failure to the record's durable history WITHOUT clearing it, so the
// next launch can see why the lifecycle stopped. Never stores secrets; the
// message is capped so a pathological error string cannot bloat the journal.
function recordCompanionFailure(error, { file = journalPath(), now = nowIso } = {}) {
  const current = readCompanionJournal({ file })
  if (!current) return null
  const failures = Array.isArray(current.failures) ? current.failures : []
  failures.push({ phase: current.phase, at: now(), error: String(error?.message || error).slice(0, 500) })
  const record = { ...current, failures, updatedAt: now() }
  return writeRecord(file, record, {})
}

/**
 * TRUST GATE. Is this record the exact shape/version/phase we wrote, with fields
 * safe enough to drive a launch or a delete? Returns { valid, reason }.
 *
 * Every clause guards a specific irreversible act:
 *   journalVersion — a record written by a DIFFERENT schema may mean something
 *                    else entirely; we never reinterpret it.
 *   phase          — recovery branches on phase; an unknown one has no branch.
 *   versions       — strict SemVer via companion-update-core's parseSemver (the
 *                    ONE parser; never reimplemented here), because recovery
 *                    decides success/failure by COMPARING the running version to
 *                    targetVersion. A version we cannot parse cannot be compared.
 *   installerSha256— the TOCTOU re-check before launch compares against this. A
 *                    malformed digest could never match, but accepting it would
 *                    let a corrupt journal choose the error we report.
 *   installerPath  — recovery may DELETE this path and apply may LAUNCH it. A
 *                    relative path would resolve against whatever cwd the app
 *                    happens to have; only an absolute path is ever trusted.
 */
function validateCompanionJournalRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { valid: false, code: 'not-an-object', reason: 'journal is not an object' }
  }
  if (record.journalVersion !== JOURNAL_VERSION) {
    return {
      valid: false,
      code: 'unknown-journal-version',
      reason: `unknown journalVersion ${JSON.stringify(record.journalVersion)} (expected ${JOURNAL_VERSION})`
    }
  }
  if (!PHASES.includes(record.phase)) {
    return { valid: false, code: 'unknown-phase', reason: `unknown phase ${JSON.stringify(record.phase)}` }
  }
  if (!parseSemver(record.targetVersion)) {
    return {
      valid: false,
      code: 'target-version-malformed',
      reason: `targetVersion ${JSON.stringify(record.targetVersion)} is not a strict SemVer`
    }
  }
  if (!parseSemver(record.currentVersion)) {
    return {
      valid: false,
      code: 'current-version-malformed',
      reason: `currentVersion ${JSON.stringify(record.currentVersion)} is not a strict SemVer`
    }
  }
  if (typeof record.installerSha256 !== 'string' || !SHA256_HEX.test(record.installerSha256)) {
    return {
      valid: false,
      code: 'installer-digest-malformed',
      reason: `installerSha256 must be exactly 64 lowercase hex characters, got ${JSON.stringify(record.installerSha256)}`
    }
  }
  if (typeof record.installerPath !== 'string' || !path.isAbsolute(record.installerPath)) {
    return {
      valid: false,
      code: 'installer-path-not-absolute',
      reason: `installerPath must be an absolute path, got ${JSON.stringify(record.installerPath)}`
    }
  }
  return { valid: true }
}

/**
 * A still-present journal means the last companion update never reached a
 * verified clear. Returns the record (for recovery) or null when there is
 * nothing to do.
 *
 * The record is VALIDATED before it is handed to recovery. A well-formed one is
 * returned as-is; a malformed/unknown one is returned with its UNTRUSTED
 * `installerPath` STRIPPED to null (and a non-hex `installerSha256` likewise),
 * plus a `malformed` marker and the reason — exactly as hermes-update-journal.cjs
 * strips an untrusted git anchor. That way recovery can still surface an honest
 * message, but can NEVER launch or delete an arbitrary executable path read out
 * of a corrupt file. A journal that isn't even valid JSON stays ignored
 * (readJson → null).
 */
function detectIncompleteCompanionUpdate({ file = journalPath() } = {}) {
  const record = readCompanionJournal({ file })
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null
  const validation = validateCompanionJournalRecord(record)
  if (validation.valid) return record
  return {
    ...record,
    installerPath: null,
    installerSha256:
      typeof record.installerSha256 === 'string' && SHA256_HEX.test(record.installerSha256)
        ? record.installerSha256
        : null,
    malformed: true,
    invalidCode: validation.code,
    invalidReason: validation.reason
  }
}

/**
 * Clear the ACTIVE journal. Two DIFFERENT durability contracts, deliberately —
 * identical in spirit to update-journal-store.cjs clearJournal:
 *   * History archive is BEST-EFFORT: a failed append is logged and swallowed.
 *     Losing history never endangers an install, so it must not block a
 *     legitimate clear.
 *   * Active-journal removal is VERIFIABLE and FAIL-CLOSED: a surviving journal
 *     would make the NEXT launch treat a finished update as incomplete (and, in
 *     the `applying` phase, re-run a version comparison against a stale target).
 *     After removal we CONFIRM absence; if the remove throws OR the file is
 *     still there (access denied, or an injected no-op rm), we THROW so no
 *     caller can mistake this for a clean clear.
 * Returns the archived record on a verified clear.
 */
function clearCompanionJournal(
  { outcome = 'completed' } = {},
  {
    file = journalPath(),
    history = historyPath(),
    now = nowIso,
    log = rememberLog,
    rm = fs.rmSync,
    exists = fs.existsSync
  } = {}
) {
  const record = readCompanionJournal({ file })
  if (record) {
    const archived = { ...record, outcome, clearedAt: now() }
    const prior = readJson(history)
    const entries = Array.isArray(prior?.entries) ? prior.entries : []
    entries.push(archived)
    const trimmed = entries.slice(-MAX_HISTORY)
    try {
      safeWrite(history, JSON.stringify({ journalVersion: JOURNAL_VERSION, entries: trimmed }, null, 2))
    } catch (error) {
      log(`Companion update journal history archive failed (non-fatal): ${error.message || error}`)
    }
  }

  try {
    rm(file, { force: true })
  } catch (error) {
    log(`Companion update journal clear failed to remove active journal ${file}: ${error.message || error}`)
    throw new Error(`Failed to remove active companion update journal (${file}): ${error.message || error}`)
  }
  if (exists(file)) {
    log(`Companion update journal clear could not confirm removal: ${file} still present`)
    throw new Error(`Active companion update journal still present after clear (${file})`)
  }
  return record
}

module.exports = {
  JOURNAL_VERSION,
  MAX_HISTORY,
  PHASES,
  SHA256_HEX,
  stateDir,
  journalPath,
  historyPath,
  nowIso,
  fsyncPath,
  readCompanionJournal,
  beginCompanionUpdate,
  updateCompanionPhase,
  recordCompanionFailure,
  validateCompanionJournalRecord,
  detectIncompleteCompanionUpdate,
  clearCompanionJournal
}
