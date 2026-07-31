const { rememberLog } = require('./logs.cjs')
const {
  isGitInstall,
  captureInstallCommit,
  resetInstallCheckout
} = require('./hermes-compat.cjs')

// Post-mutation recovery policy for a FAILED Hermes self-update.
//
// The only automatic remediation we perform is resetting the git install
// checkout (code only — <hermesHome>/hermes-agent) back to the commit we
// captured BEFORE the update. That never touches <hermesHome>/sessions,
// /skills, /memories or state.db — those live OUTSIDE the checkout.
//
// For a non-git install there is no official in-place restore we can safely
// drive unattended (`hermes import` would overwrite a live home from a ZIP —
// itself a destructive act mid-failure), so we FAIL CLOSED: no guesswork, just
// an honest message pointing at the verified pre-update backup for manual
// support. `hermes update` on a managed install already keeps its own snapshot;
// we do not race it with a second restore.

function manualSupportMessage(backupPath) {
  const backup = backupPath
    ? `גיבוי מלא מאומת נשמר לפני העדכון: ${backupPath}`
    : 'לא נמצא גיבוי מאומת לפני העדכון'
  return (
    'עדכון Hermes נכשל ולא ניתן היה לשחזר את ההתקנה אוטומטית בבטחה. ' +
    `${backup}. ` +
    'לשחזור בטוח פנה לתמיכה עם קובץ הגיבוי; המידע שלך (שיחות, כישורים, זיכרון) לא נגע.'
  )
}

// Snapshot the rollback anchor before the update mutates anything. Helpers are
// injectable so the update flow can be DI-tested without a live git checkout.
function captureRollbackAnchor(command, { isGit = isGitInstall, capture = captureInstallCommit } = {}) {
  if (!isGit(command)) return { gitInstall: false, anchor: null }
  return { gitInstall: true, anchor: capture(command) }
}

// Attempt recovery after the update failed AFTER mutation began. Returns
// { restored, method, commit?, message? }. When `restored` is false, `message`
// is the honest fail-closed copy the UI must surface.
function rollbackAfterFailedUpdate(
  { command, anchor, backupPath },
  { isGit = isGitInstall, reset = resetInstallCheckout, log = rememberLog } = {}
) {
  if (!isGit(command)) {
    // Non-git install: no safe unattended restore. Fail closed.
    log('Hermes update rollback: non-git install, failing closed to verified backup')
    return { restored: false, method: 'non-git', message: manualSupportMessage(backupPath) }
  }
  if (!anchor) {
    // Git install but we never captured a commit — do NOT guess a reset target.
    log('Hermes update rollback skipped: no git anchor was captured before the update')
    return { restored: false, method: 'git', message: manualSupportMessage(backupPath) }
  }
  const result = reset(command, anchor)
  if (result.ok) {
    log(`Hermes install checkout reset to pre-update commit ${anchor}`)
    return { restored: true, method: 'git', commit: anchor }
  }
  log(`Hermes update rollback reset failed (${result.reason})${result.detail ? `: ${result.detail}` : ''}`)
  return { restored: false, method: 'git', message: manualSupportMessage(backupPath) }
}

module.exports = { captureRollbackAnchor, rollbackAfterFailedUpdate, manualSupportMessage }
