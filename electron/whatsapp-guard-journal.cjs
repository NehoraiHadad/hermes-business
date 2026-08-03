const fs = require('node:fs')
const path = require('node:path')
const { hermesHome } = require('./paths.cjs')
const { safeWrite } = require('./atomic-write.cjs')
const { rememberLog } = require('./logs.cjs')

// Durable, observable record of the WhatsApp guard ACTIVATION transaction: when a
// plugin update forces a gateway restart, this journal captures each phase so the UI can
// render a truthful state and a crash-interrupted restart can be recovered on next launch.
//
// Phases (status): 'restarting' → 'verifying' → 'active' | 'failed'. While the transaction
// is in-flight or failed, the pre-restart nonce is kept as `supersedeNonce` so the status
// reader fails closed on the OLD gateway's heartbeat until the NEW process publishes a fresh
// one. Once 'active', supersede clears and a live heartbeat verifies normally.
//
// Contract (mirrors update-journal-store.cjs): writes are atomic (temp + rename via
// safeWrite); a record is trusted only after field-level validation (a legacy/malformed
// file fails closed to `null` — no journal — rather than crashing or being trusted
// half-parsed); and a clear is VERIFIABLE — it confirms the file is actually gone and
// throws if it survives deletion, so a caller can never mistake a failed clear for a clean
// one. This module owns journaling ONLY; the activation-aware status reader lives in
// whatsapp-guard-status.cjs (re-exported here too, for the pre-existing IPC import site).

const JOURNAL_SCHEMA = 1
const STATUSES = new Set(['restarting', 'verifying', 'active', 'failed'])

function journalPath() {
  return path.join(hermesHome(), 'business-state', 'whatsapp-guard-activation.json')
}

// Field-level validation so a legacy/corrupted/hand-edited file is never trusted
// half-parsed. Fails closed to `null` (treated as "no journal") — never throws.
function isValidJournalRecord(raw) {
  if (!raw || typeof raw !== 'object') return false
  if (raw.schema !== JOURNAL_SCHEMA) return false
  if (!STATUSES.has(raw.status)) return false
  if (typeof raw.updatedAt !== 'string') return false
  if (raw.changed !== undefined && typeof raw.changed !== 'boolean') return false
  if (raw.supersedeNonce !== undefined && raw.supersedeNonce !== null && typeof raw.supersedeNonce !== 'string') {
    return false
  }
  if (raw.expectedVersion !== undefined && raw.expectedVersion !== null && typeof raw.expectedVersion !== 'string') {
    return false
  }
  if (raw.reason !== undefined && typeof raw.reason !== 'string') return false
  return true
}

function readGuardActivationJournal() {
  try {
    const raw = JSON.parse(fs.readFileSync(journalPath(), 'utf8'))
    return isValidJournalRecord(raw) ? raw : null
  } catch {
    return null
  }
}

function writeGuardActivationJournal(entry) {
  const record = { schema: JOURNAL_SCHEMA, updatedAt: new Date().toISOString(), ...entry }
  safeWrite(journalPath(), `${JSON.stringify(record, null, 2)}\n`)
  return record
}

// Verifiable clear: removes the journal and CONFIRMS its absence. If the remove throws OR
// the file still exists afterward (access denied, an injected no-op rm, ...), this throws —
// callers must not mistake a failed clear for a clean one. Injectable for tests.
function clearGuardActivationJournal({
  file = journalPath(),
  rm = fs.rmSync,
  exists = fs.existsSync,
  log = rememberLog
} = {}) {
  try {
    rm(file, { force: true })
  } catch (error) {
    log(`Guard activation journal clear failed to remove ${file}: ${error.message || error}`)
    throw new Error(`Failed to remove guard activation journal (${file}): ${error.message || error}`)
  }
  if (exists(file)) {
    log(`Guard activation journal clear could not confirm removal: ${file} still present`)
    throw new Error(`Guard activation journal still present after clear (${file})`)
  }
}

module.exports = {
  JOURNAL_SCHEMA,
  journalPath,
  isValidJournalRecord,
  readGuardActivationJournal,
  writeGuardActivationJournal,
  clearGuardActivationJournal,
  // Backward-compatible re-export: guardStatusWithActivation's real home is now
  // whatsapp-guard-status.cjs (it is a status reader, not a journal primitive) —
  // kept here too because electron/ipc.cjs imports it from this module. A lazy
  // getter (rather than a top-level require) avoids either file observing the
  // other's partially-initialized exports, regardless of load order.
  get guardStatusWithActivation() {
    return require('./whatsapp-guard-status.cjs').guardStatusWithActivation
  }
}
