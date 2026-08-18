const { app, ipcMain } = require('electron')
const { rememberLog } = require('./logs.cjs')
const { createSerialGuard } = require('./ipc-guards.cjs')
const { getMainWindow } = require('./windows.cjs')
const { checkCompanionUpdate } = require('./companion-update.cjs')
const { downloadCompanionUpdate } = require('./companion-download.cjs')
const { applyCompanionUpdate } = require('./companion-apply.cjs')
const { readCompanionJournal } = require('./companion-update-journal.cjs')
const { compareSemver } = require('./companion-update-core.cjs')
const { appVersion } = require('./app-version.cjs')
const { resolveRollbackOffer, downloadCompanionRollback } = require('./companion-rollback.cjs')

// IPC surface for the CONSENTED תכל'ס (companion) one-click update
// (docs/specs/versioning.md §6.4, §7). The CHECK lives in ipc.cjs; this module
// owns the two actions that follow it — download+verify, and apply.
//
// THE CENTRAL RULE OF THIS FILE: **the renderer supplies no input at all.**
// Not a URL, not a path, not a version. `hermes:companion-update` already
// established that the renderer's only input is a `force` boolean (D5: "the
// renderer never talks to api.github.com directly"); these two handlers go
// further and take nothing, because between them they download an executable
// and then RUN it. Every operand — which release, which asset URL, which file
// on disk — is derived inside main from artifacts main itself produced:
//   * the download's URLs come from the verdict `checkCompanionUpdate` decided;
//   * the apply's installer path comes from the durable journal, which
//     `companion-apply.cjs` treats as authoritative and cross-checks.
// A renderer compromise therefore cannot redirect either step; the worst it can
// do is trigger the same update the owner could have triggered by clicking.

// One download at a time across the whole app. `downloadCompanionUpdate` owns
// its own internal guard too, but that one resolves a `busy` verdict; this one
// exists so the CANCEL handler has a single unambiguous in-flight download to
// abort, and so a second click cannot orphan the first AbortController.
const runDownloadExclusively = createSerialGuard('הורדת העדכון כבר מתבצעת')

// The AbortController of the in-flight download, or null. Module-scoped rather
// than passed through IPC precisely so the renderer cannot name which download
// to cancel — there is only ever one.
let inFlight = null

function pushProgress(progress) {
  const win = getMainWindow()
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send('hermes:companion-download-progress', progress)
}

/**
 * Download + verify the update the last CHECK decided on. Never rejects: every
 * failure resolves to the engine's structured `{ok:false, code, message}`,
 * matching the fail-closed contract the check surface already publishes (§8).
 *
 * `force:false` on the re-check is deliberate — it reuses the cached verdict the
 * user is looking at rather than racing a fresh network call whose answer could
 * differ from what they consented to.
 */
async function handleDownload() {
  try {
    return await runDownloadExclusively(async () => {
      const verdict = await checkCompanionUpdate({ force: false })
      if (verdict.status !== 'update-available') {
        return { ok: false, code: 'no-update', message: 'אין עדכון זמין להורדה כרגע.' }
      }
      // `managedUpdate:false` means the release exists but is missing the
      // installer or the signed manifest asset — an honest "this release cannot
      // be updated in place", never a silent fallback to an unverified download.
      if (!verdict.managedUpdate) {
        return {
          ok: false,
          code: verdict.managedUpdateReason || 'managed-update-unavailable',
          message: 'לא ניתן לעדכן אוטומטית מגרסה זו. ניתן להוריד ולהתקין ידנית מדף ההורדה.'
        }
      }
      const controller = new AbortController()
      inFlight = controller
      try {
        return await downloadCompanionUpdate(
          {
            version: verdict.latest,
            installerUrl: verdict.installerUrl,
            manifestUrl: verdict.manifestUrl,
            signal: controller.signal
          },
          { onProgress: pushProgress }
        )
      } finally {
        inFlight = null
      }
    })
  } catch (error) {
    // The serial guard's busy rejection is the only expected throw here.
    const message = error && error.message ? error.message : 'הורדת העדכון נכשלה.'
    rememberLog(`Companion update download failed: ${message}`)
    return { ok: false, code: 'busy', message }
  }
}

/**
 * Download + verify the installer for the version this install came FROM (F5).
 *
 * Takes no parameters for the same reason `handleDownload` takes none, only more
 * so: this one moves the app BACKWARDS, and the destination is read out of main's
 * own durable journal. A renderer that could name the version would be able to
 * name any version — which is precisely the downgrade primitive the forward
 * path's "strictly newer" rule exists to deny.
 *
 * Shares `runDownloadExclusively` and the `inFlight` controller with the forward
 * download on purpose: an update and a rollback must never race each other into
 * the same journal, and the existing cancel handler then aborts whichever one is
 * running without needing to know which it was.
 */
async function handleRollbackDownload() {
  try {
    return await runDownloadExclusively(async () => {
      const controller = new AbortController()
      inFlight = controller
      try {
        return await downloadCompanionRollback({ signal: controller.signal }, { onProgress: pushProgress })
      } finally {
        inFlight = null
      }
    })
  } catch (error) {
    const message = error && error.message ? error.message : 'החזרה לגרסה הקודמת נכשלה.'
    rememberLog(`Companion rollback download failed: ${message}`)
    return { ok: false, code: 'busy', message }
  }
}

/**
 * Is a rollback on offer, and to where? Read-only and offline (two local file
 * reads), so the UI can call it on mount. Scalars only — the same rule the
 * update-state handler follows.
 */
function handleRollbackOffer() {
  try {
    const offer = resolveRollbackOffer()
    return {
      available: offer.available === true,
      target: offer.target || null,
      from: offer.from || null,
      code: offer.code || null,
      message: offer.message || null
    }
  } catch (error) {
    // Fail CLOSED: an unreadable journal means we cannot prove a previous version
    // ever ran here, so no offer is made. Never a default-on.
    rememberLog(`Companion rollback offer check failed: ${error?.message || error}`)
    return { available: false, target: null, from: null, code: 'offer-check-failed', message: 'לא ניתן לבדוק אם קיימת גרסה קודמת לחזור אליה.' }
  }
}

/**
 * Apply a download that already reached the journal's `ready` phase. This QUITS
 * THE APP on success — it is the last thing this process does.
 *
 * The `ready` precondition is re-asserted here even though `applyCompanionUpdate`
 * validates the journal itself: this handler is the consent boundary, and
 * refusing to even call apply unless a VERIFIED installer is recorded keeps the
 * "nothing executes that we did not download and hash" property legible at the
 * boundary rather than only deep inside the apply module.
 */
async function handleApply() {
  const record = readCompanionJournal({})
  if (!record || record.phase !== 'ready') {
    return { ok: false, code: 'not-ready', message: 'אין עדכון מאומת שמוכן להתקנה.' }
  }
  try {
    return await applyCompanionUpdate({
      installerPath: record.installerPath,
      targetVersion: record.targetVersion
    })
  } catch (error) {
    const message = error && error.message ? error.message : 'הפעלת ההתקנה נכשלה.'
    rememberLog(`Companion update apply failed: ${message}`)
    return { ok: false, code: 'apply-failed', message }
  }
}

/**
 * Read-only view of the durable journal for the UI, so a verified-but-unapplied
 * download survives a restart as a resumable offer (the `resumable` outcome
 * `recoverIncompleteCompanionUpdate` reports at launch). Scalars only — the
 * installer path never crosses to the renderer, since the renderer has no
 * legitimate use for it and cannot pass one back.
 */
function handleState() {
  const record = readCompanionJournal({})
  if (!record) return { phase: null, targetVersion: null, currentVersion: appVersion(), direction: null }
  return {
    phase: record.phase || null,
    targetVersion: record.targetVersion || null,
    currentVersion: appVersion(),
    // Which WAY a pending record points, decided here rather than in the
    // renderer: the ONE SemVer implementation lives in main
    // (companion-update-core.cjs), and a renderer-side string comparison would be
    // a second, wrong ordering — '0.4.0-alpha.10' sorts below '0.4.0-alpha.9'
    // lexically, which is precisely the bug that was found in the installer's
    // PowerShell SemVer at alpha.9. `null` when the two cannot be ordered: the
    // UI must not guess a direction it cannot prove.
    direction: directionOf(record.currentVersion, record.targetVersion)
  }
}

function directionOf(from, to) {
  const cmp = compareSemver(to, from)
  if (cmp === null || cmp === 0) return null
  return cmp > 0 ? 'forward' : 'rollback'
}

function registerCompanionUpdateIpc() {
  ipcMain.handle('hermes:companion-download', () => handleDownload())
  ipcMain.handle('hermes:companion-apply', () => handleApply())
  ipcMain.handle('hermes:companion-update-state', () => handleState())
  ipcMain.handle('hermes:companion-rollback-offer', () => handleRollbackOffer())
  ipcMain.handle('hermes:companion-rollback-download', () => handleRollbackDownload())
  // Cancel is a no-op when nothing is in flight — never an error, so a stale
  // click from a renderer whose download already finished cannot surface a
  // spurious failure.
  ipcMain.handle('hermes:companion-download-cancel', () => {
    if (!inFlight) return { ok: true, cancelled: false }
    inFlight.abort()
    return { ok: true, cancelled: true }
  })
}

module.exports = {
  registerCompanionUpdateIpc,
  handleDownload,
  handleApply,
  handleState,
  handleRollbackOffer,
  handleRollbackDownload
}
