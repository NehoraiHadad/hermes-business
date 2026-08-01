const { findHermes } = require('./paths.cjs')
const { rememberLog } = require('./logs.cjs')
const { assertFullHealth } = require('./hermes-health.cjs')
const { rollbackAfterFailedUpdate } = require('./hermes-rollback.cjs')
const {
  detectIncompleteUpdate,
  recordFailure,
  clearJournal
} = require('./hermes-update-journal.cjs')

// Launch-time recovery for an update that was interrupted (crash, power loss, or
// a failure the flow could not finish handling). Runs on app readiness. It is
// deterministic and idempotent — a still-present journal is the single trigger.
//
// Order of remediation:
//   1. Detect an incomplete journal. None → nothing to do.
//   2. Assert BOTH foreground serve health AND background gateway deep health as
//      the install currently sits. If both pass, the update effectively landed
//      (it just never got to clear the journal) → archive + clear as recovered.
//   3. Otherwise, roll back to the captured git anchor (non-git → fail closed to
//      the verified backup) and re-assert BOTH healths. Only if the rollback
//      restored the checkout AND both healths pass do we clear the journal.
//   4. If we still cannot reach a verified-healthy state, we LEAVE the journal in
//      place (so the next launch retries), record the failures, and surface an
//      honest, non-secret message for the UI. We never report restored/running
//      unless both checks actually pass.

async function recoverIncompleteUpdate(deps = {}) {
  const {
    detect = detectIncompleteUpdate,
    resolveCommand = findHermes,
    fullHealth = assertFullHealth,
    rollback = rollbackAfterFailedUpdate,
    fail = recordFailure,
    clear = clearJournal,
    log = rememberLog
  } = deps

  const record = detect()
  if (!record) return { recovered: false, action: 'none' }
  log(`Detected incomplete Hermes update (phase=${record.phase}); attempting deterministic recovery`)

  const command = resolveCommand()
  if (!command) {
    fail(new Error('Hermes binary not found during update recovery'))
    return { recovered: false, action: 'no-command', message: 'Hermes אינו מותקן; לא ניתן להשלים שחזור עדכון.' }
  }

  // 2. Is the install already verified-healthy as it sits?
  try {
    await fullHealth(command)
    clear({ outcome: 'recovered-healthy' })
    log('Incomplete update recovered: install is healthy; journal cleared')
    return { recovered: true, action: 'already-healthy', record }
  } catch (healthError) {
    fail(healthError)
    log(`Post-crash health failed (${healthError.message || healthError}); attempting rollback`)
  }

  // 3. Roll back to the pre-update anchor and re-assert both healths.
  const outcome = rollback({ command, anchor: record.anchor, backupPath: record.backupPath })
  if (outcome.restored) {
    try {
      await fullHealth(command)
      clear({ outcome: 'recovered-rolledback' })
      log(`Incomplete update rolled back to ${String(outcome.commit).slice(0, 10)} and verified healthy; journal cleared`)
      return { recovered: true, action: 'rolled-back', commit: outcome.commit, record }
    } catch (afterRollbackError) {
      fail(afterRollbackError)
      log(`Rollback restored the checkout but health still failed: ${afterRollbackError.message || afterRollbackError}`)
      return {
        recovered: false,
        action: 'rolled-back-unhealthy',
        message: 'שחזור העדכון הוחזר לגרסה הקודמת אך בדיקות הבריאות עדיין נכשלות; פנה לתמיכה.',
        record
      }
    }
  }

  // 4. Could not restore automatically — leave the journal for the next launch
  // and surface the honest fail-closed message (points at the verified backup).
  log('Incomplete update could not be recovered automatically; journal preserved for retry')
  return { recovered: false, action: 'fail-closed', message: outcome.message, record }
}

module.exports = { recoverIncompleteUpdate }
