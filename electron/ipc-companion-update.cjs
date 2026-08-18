const { app, ipcMain } = require('electron')
const { rememberLog } = require('./logs.cjs')
const { createSerialGuard } = require('./ipc-guards.cjs')
const { getMainWindow } = require('./windows.cjs')
const { checkCompanionUpdate } = require('./companion-update.cjs')
const { downloadCompanionUpdate } = require('./companion-download.cjs')
const { applyCompanionUpdate } = require('./companion-apply.cjs')
const { readCompanionJournal } = require('./companion-update-journal.cjs')

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
  if (!record) return { phase: null, targetVersion: null, currentVersion: app.getVersion() }
  return {
    phase: record.phase || null,
    targetVersion: record.targetVersion || null,
    currentVersion: app.getVersion()
  }
}

function registerCompanionUpdateIpc() {
  ipcMain.handle('hermes:companion-download', () => handleDownload())
  ipcMain.handle('hermes:companion-apply', () => handleApply())
  ipcMain.handle('hermes:companion-update-state', () => handleState())
  // Cancel is a no-op when nothing is in flight — never an error, so a stale
  // click from a renderer whose download already finished cannot surface a
  // spurious failure.
  ipcMain.handle('hermes:companion-download-cancel', () => {
    if (!inFlight) return { ok: true, cancelled: false }
    inFlight.abort()
    return { ok: true, cancelled: true }
  })
}

module.exports = { registerCompanionUpdateIpc, handleDownload, handleApply, handleState }
