const { waitForFreshHeartbeat } = require('./whatsapp-guard-activation.cjs')
const {
  writeGuardActivationJournal,
  readGuardActivationJournal
} = require('./whatsapp-guard-journal.cjs')

// Finish a crash/quit-interrupted guard-restart transaction: re-verify against the recorded
// supersede nonce and finalize the journal to 'active' or 'failed'. Idempotent.
//
// ORDERING CONTRACT: this MUST run BEFORE activateWhatsappGuard on launch. Activation's pending
// path can clear a stale journal and its restart path writes a new one — either would erase an
// unfinished restart before it is recovered. Running recovery first guarantees an interrupted
// transaction is either completed (active) or honestly failed before activation touches it.
async function recoverGuardActivation(options = {}) {
  const journal = options.journal !== undefined ? options.journal : readGuardActivationJournal()
  if (!journal || (journal.status !== 'restarting' && journal.status !== 'verifying')) {
    return { action: 'none' }
  }
  const verified = await waitForFreshHeartbeat({
    ...options,
    expectedVersion: journal.expectedVersion,
    supersedeNonce: journal.supersedeNonce || null,
    timeoutMs: options.timeoutMs ?? 10_000
  })
  if (verified) {
    writeGuardActivationJournal({
      status: 'active',
      changed: Boolean(journal.changed),
      expectedVersion: journal.expectedVersion
    })
    return { action: 'recovered', active: true }
  }
  writeGuardActivationJournal({ status: 'failed', reason: 'recovery-timeout', changed: Boolean(journal.changed) })
  return { action: 'failed', active: false }
}

module.exports = { recoverGuardActivation }
