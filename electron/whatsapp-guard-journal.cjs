const fs = require('node:fs')
const path = require('node:path')
const { hermesHome } = require('./paths.cjs')
const {
  getWhatsappGuardStatus,
  installedPluginVersion
} = require('./whatsapp-guard.cjs')

// Durable, observable record of the WhatsApp/Telegram guard ACTIVATION transaction: when a
// plugin update forces a gateway restart, this journal captures each phase so the UI can
// render a truthful state and a crash-interrupted restart can be recovered on next launch.
//
// Phases (status): 'restarting' → 'verifying' → 'active' | 'failed'. While the transaction
// is in-flight or failed, the pre-restart nonce is kept as `supersedeNonce` so the status
// reader fails closed on the OLD gateway's heartbeat until the NEW process publishes a fresh
// one. Once 'active', supersede clears and a live heartbeat verifies normally.

const JOURNAL_SCHEMA = 1
const IN_FLIGHT = new Set(['restarting', 'verifying'])

function journalPath() {
  return path.join(hermesHome(), 'business-state', 'whatsapp-guard-activation.json')
}

function readGuardActivationJournal() {
  try {
    const raw = JSON.parse(fs.readFileSync(journalPath(), 'utf8'))
    return raw && typeof raw === 'object' && raw.schema === JOURNAL_SCHEMA ? raw : null
  } catch {
    return null
  }
}

function writeGuardActivationJournal(entry) {
  const record = { schema: JOURNAL_SCHEMA, updatedAt: new Date().toISOString(), ...entry }
  const target = journalPath()
  const tmp = `${target}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, target)
  return record
}

function clearGuardActivationJournal() {
  try {
    fs.rmSync(journalPath(), { force: true })
  } catch {
    /* best effort */
  }
}

function isActivationInFlight(journal = readGuardActivationJournal()) {
  return Boolean(journal && IN_FLIGHT.has(journal.status))
}

// Activation-aware guard status for the UI/IPC. A connection may be reported connected/
// enabled ONLY when this returns a live proof. When a restart transaction is in-flight or
// failed, the pre-restart nonce is superseded so the stale gateway heartbeat fails closed.
function guardStatusWithActivation(deps = {}) {
  const read = deps.read || getWhatsappGuardStatus
  const journal = deps.journal !== undefined ? deps.journal : readGuardActivationJournal()
  const supersedeNonce =
    journal && journal.status !== 'active' && journal.supersedeNonce ? journal.supersedeNonce : undefined
  const forward = { supersedeNonce }
  if (deps.now !== undefined) forward.now = deps.now
  if (deps.isPidAlive) forward.isPidAlive = deps.isPidAlive
  if (deps.installedVersion) forward.installedVersion = deps.installedVersion
  return read(forward)
}

module.exports = {
  JOURNAL_SCHEMA,
  journalPath,
  readGuardActivationJournal,
  writeGuardActivationJournal,
  clearGuardActivationJournal,
  isActivationInFlight,
  guardStatusWithActivation,
  installedPluginVersion
}
