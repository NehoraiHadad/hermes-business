const {
  JOURNAL_VERSION,
  PHASES,
  RECOVERABLE_METHODS,
  ANCHOR_PATTERN,
  stateDir,
  journalPath,
  historyPath,
  readJournal,
  beginUpdate,
  updatePhase,
  recordFailure,
  clearJournal
} = require('./update-journal-store.cjs')

// The TRUST GATE over the durable update journal. The persistence engine (atomic
// read/write, paths, versioning, lifecycle writes, verifiable clear) lives in
// update-journal-store.cjs; this module decides whether a surviving record may be
// TRUSTED to drive a destructive `git reset` on the next launch, and stays the
// single public entry point (re-exporting the store's API) for the update flow
// and launch-time recovery.

// Validate that a journal record is the exact shape/version/method/anchor we
// wrote, so recovery can trust its rollback anchor. Returns { valid, reason }.
// A record that fails here must NOT drive a destructive `git reset` — the
// caller strips the untrusted anchor and fails closed to manual support.
function validateJournalRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { valid: false, reason: 'journal is not an object' }
  }
  if (record.journalVersion !== JOURNAL_VERSION) {
    return { valid: false, reason: `unknown journalVersion ${JSON.stringify(record.journalVersion)} (expected ${JOURNAL_VERSION})` }
  }
  if (!PHASES.includes(record.phase)) {
    return { valid: false, reason: `unknown phase ${JSON.stringify(record.phase)}` }
  }
  if (!RECOVERABLE_METHODS.includes(record.method)) {
    return { valid: false, reason: `unrecoverable/unknown install method ${JSON.stringify(record.method)}` }
  }
  if (typeof record.anchor !== 'string' || !ANCHOR_PATTERN.test(record.anchor)) {
    return { valid: false, reason: 'missing or malformed rollback anchor (not a git sha)' }
  }
  if (record.backupPath != null && typeof record.backupPath !== 'string') {
    return { valid: false, reason: 'malformed backupPath (not a string)' }
  }
  return { valid: true }
}

// A still-present journal means the last update never reached a verified-healthy
// clear. Returns the record (for recovery) or null when there is nothing to do.
//
// The record is VALIDATED before it is handed to recovery: a well-formed
// incomplete journal is returned as-is, but a malformed/unknown one (bad
// version/shape/method/anchor) is returned with its untrusted `anchor` (and any
// non-string `backupPath`) stripped and a `malformed` marker attached. That way
// recovery can still re-check health and surface an honest support/retry
// message, but can NEVER `git reset` to an arbitrary anchor read from a corrupt
// file. A journal that isn't even valid JSON stays ignored (readJson → null).
function detectIncompleteUpdate({ file = journalPath() } = {}) {
  const record = readJournal({ file })
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null
  if (record.phase === 'completed') return null
  const validation = validateJournalRecord(record)
  if (validation.valid) return record
  return {
    ...record,
    anchor: null,
    backupPath: typeof record.backupPath === 'string' ? record.backupPath : null,
    malformed: true,
    invalidReason: validation.reason
  }
}

module.exports = {
  JOURNAL_VERSION,
  PHASES,
  RECOVERABLE_METHODS,
  ANCHOR_PATTERN,
  stateDir,
  journalPath,
  historyPath,
  readJournal,
  beginUpdate,
  updatePhase,
  recordFailure,
  validateJournalRecord,
  detectIncompleteUpdate,
  clearJournal
}
