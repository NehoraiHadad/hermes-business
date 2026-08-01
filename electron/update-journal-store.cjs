const fs = require('node:fs')
const path = require('node:path')
const { hermesHome } = require('./paths.cjs')
const { safeWrite } = require('./atomic-write.cjs')
const { rememberLog } = require('./logs.cjs')

// Durable persistence engine for the in-flight-update journal. It lives under
// <hermesHome>/business-state — a SIBLING of the install checkout
// (<hermesHome>/hermes-agent), never inside it, so a `git reset` rollback can
// never disturb it. Writes are atomic (temp + rename via safeWrite), so a
// power-loss mid-write can never leave a half-written record. It records ONLY
// non-secret operational metadata: install method, the git anchor (a public
// commit sha), current/target versions, the backup PATH (not its contents), the
// current phase and timestamps — no tokens, no secrets.
//
// This module owns the on-disk shape (paths, versioning, atomic read/write) and
// the lifecycle writes (begin/update/record/clear). The trust gate that decides
// whether a surviving record may drive a destructive rollback lives in
// hermes-update-journal.cjs.

const JOURNAL_VERSION = 1
const MAX_HISTORY = 20

// Phases, in order. A journal in any phase other than a terminal-clean one
// (removed on clear) is considered incomplete on the next launch.
const PHASES = Object.freeze([
  'preflight',
  'stopping',
  'backup',
  'mutating',
  'recovering',
  'verifying'
])

// The only install method eligible for unattended auto-update (managed/unknown
// are refused at preflight — see hermes-compat.cjs), so a legitimate journal is
// always a git one. Recovery must never git-reset to an anchor read from a file
// whose method it doesn't recognize.
const RECOVERABLE_METHODS = Object.freeze(['git'])
// Matches hermes-compat.cjs SHA_PATTERN: a captured rollback anchor is a git sha
// (7..40 hex). We refuse to trust anything else as a reset target.
const ANCHOR_PATTERN = /^[0-9a-f]{7,40}$/i

function stateDir(home = hermesHome()) {
  return path.join(home, 'business-state')
}
function journalPath(home = hermesHome()) {
  return path.join(stateDir(home), 'update-journal.json')
}
function historyPath(home = hermesHome()) {
  return path.join(stateDir(home), 'update-journal-history.json')
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

function readJournal({ file = journalPath() } = {}) {
  return readJson(file)
}

// Begin a new update record BEFORE any mutation. Overwrites any stale journal
// atomically. `now` is injectable for deterministic tests.
function beginUpdate(
  { method, anchor = null, currentVersion = null, targetVersion = null, backupPath = null } = {},
  { file = journalPath(), now = nowIso } = {}
) {
  const stamp = now()
  const record = {
    journalVersion: JOURNAL_VERSION,
    phase: 'preflight',
    method: method || null,
    anchor: anchor || null,
    currentVersion: currentVersion || null,
    targetVersion: targetVersion || null,
    backupPath: backupPath || null,
    startedAt: stamp,
    updatedAt: stamp,
    failures: []
  }
  safeWrite(file, JSON.stringify(record, null, 2))
  return record
}

// Advance the phase and merge a shallow patch (e.g. { backupPath }). No-op-safe:
// if the journal vanished it is not recreated (recovery decides what to do).
function updatePhase(phase, patch = {}, { file = journalPath(), now = nowIso } = {}) {
  const current = readJournal({ file })
  if (!current) return null
  const record = { ...current, ...patch, phase, updatedAt: now() }
  safeWrite(file, JSON.stringify(record, null, 2))
  return record
}

// Append a failure to the record's durable history without clearing it, so the
// launch-time recovery can see WHY the update stopped. Never stores secrets.
function recordFailure(error, { file = journalPath(), now = nowIso } = {}) {
  const current = readJournal({ file })
  if (!current) return null
  const failures = Array.isArray(current.failures) ? current.failures : []
  failures.push({ phase: current.phase, at: now(), error: String(error?.message || error).slice(0, 500) })
  const record = { ...current, failures, updatedAt: now() }
  safeWrite(file, JSON.stringify(record, null, 2))
  return record
}

// Clear the ACTIVE journal — the ONLY allowed after both runtime and gateway
// deep health pass. The record (with outcome + failure history) is archived to a
// bounded history file, then the active journal is removed and its ABSENCE is
// verified. Two DIFFERENT durability contracts:
//   * History archive is BEST-EFFORT: a failed append is logged and swallowed —
//     losing failure history never endangers the install, so it must not block a
//     legitimate clear.
//   * Active-journal removal is VERIFIABLE and FAIL-CLOSED: it MUST NOT silently
//     survive a "successful" clear (that would let an update report success while
//     a surviving journal makes the next launch treat it as incomplete). After
//     removal we CONFIRM the file is gone; if the remove throws OR the file still
//     exists (access denied, or an injected no-op rm), we THROW so the caller
//     cannot mistake this for a clean clear.
// Returns the archived record on a verified clear.
function clearJournal(
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
  const record = readJournal({ file })
  if (record) {
    // Best-effort history archive (documented above) — never blocks the clear.
    const archived = { ...record, outcome, clearedAt: now() }
    const prior = readJson(history)
    const entries = Array.isArray(prior?.entries) ? prior.entries : []
    entries.push(archived)
    const trimmed = entries.slice(-MAX_HISTORY)
    try {
      safeWrite(history, JSON.stringify({ journalVersion: JOURNAL_VERSION, entries: trimmed }, null, 2))
    } catch (error) {
      log(`Update journal history archive failed (non-fatal): ${error.message || error}`)
    }
  }

  // Verifiable active-journal removal.
  try {
    rm(file, { force: true })
  } catch (error) {
    log(`Update journal clear failed to remove active journal ${file}: ${error.message || error}`)
    throw new Error(`Failed to remove active update journal (${file}): ${error.message || error}`)
  }
  if (exists(file)) {
    log(`Update journal clear could not confirm removal: ${file} still present`)
    throw new Error(`Active update journal still present after clear (${file})`)
  }
  return record
}

module.exports = {
  JOURNAL_VERSION,
  MAX_HISTORY,
  PHASES,
  RECOVERABLE_METHODS,
  ANCHOR_PATTERN,
  stateDir,
  journalPath,
  historyPath,
  nowIso,
  readJson,
  readJournal,
  beginUpdate,
  updatePhase,
  recordFailure,
  clearJournal
}
