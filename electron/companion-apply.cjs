const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const childProcess = require('node:child_process')
const { rememberLog } = require('./logs.cjs')
const { findHermes } = require('./paths.cjs')
const { runCaptured } = require('./process-util.cjs')
const { officialGatewayState } = require('./gateway-status.cjs')
const { compareSemver, parseSemver } = require('./companion-update-core.cjs')
const {
  readCompanionJournal,
  updateCompanionPhase,
  recordCompanionFailure,
  detectIncompleteCompanionUpdate,
  clearCompanionJournal,
  validateCompanionJournalRecord
} = require('./companion-update-journal.cjs')

// APPLY stage of the in-app one-click updater for תכל'ס itself: hand an
// already-downloaded, already-verified NSIS installer to Windows, get out of its
// way, and reconcile what actually happened at the NEXT launch.
//
// Every side-effecting collaborator (spawn, fs, journal, gateway stop, runtime
// stop, Electron's `app`, the health gate) is injectable through `deps`, in the
// same DI style as hermes-update-flow.cjs, so the ORDERING below is unit-testable
// with no real Electron, no real spawn and no real installer. The Electron-bound
// defaults are resolved LAZILY (require inside the function) so this module can
// be loaded under vitest at all.
//
// ── Facts about our generated NSIS script that this design is built on ────────
// The exact argv is `<installer.exe> /S --updated --force-run /currentuser`:
//   /S           — NSIS silent mode.
//   --updated    — MANDATORY, not cosmetic. It (a) suppresses the "app is
//                  running, close it?" MessageBox and instead SLEEPS to let us
//                  exit gracefully; (b) is the only thing that sets
//                  isTryToKeepShortcuts, without which this app's Hebrew desktop
//                  and Start-Menu shortcuts are DELETED and recreated on every
//                  update; (c) makes the old uninstaller preserve app data; and
//                  (d) is forwarded as argv to the relaunched app.
//   --force-run  — for an assisted (oneClick:false) installer, `${isForceRun} &&
//                  ${Silent}` is the ONLY code path that relaunches the app after
//                  a silent install.
//   /currentuser — SLASH form, not `--currentuser`. Forces
//                  hasPerMachineInstallation=0. Without it, a user who ever
//                  installed "for all users" gets a UAC prompt in the middle of a
//                  supposedly silent update, and cancelling it aborts the update.
//
// Two consequences drive everything below:
//   1. THE INSTALLER KILLS US. Its KILL_PROCESS matches every process whose
//      executable path starts with $INSTDIR — which includes this Electron main
//      process. So the spawn is detached + stdio:'ignore' + unref(): we never
//      await it and never read an exit code, because the parent will be dead.
//   2. FAILURES ARE SILENT. The generated script uses /SD IDCANCEL on its retry
//      dialogs and ShowInstDetails nevershow, so an installer that cannot kill
//      the app or hits a locked file simply Quits — no log, no observable exit
//      code. Success/failure is therefore decided OUT-OF-BAND at the next launch
//      by comparing the RUNNING app version to the journalled target.

/**
 * The exact, complete argv the installer is launched with. Exported so the test
 * suite (and any future contract check) asserts the real constant rather than a
 * copy of it — every flag here is load-bearing; see the header.
 */
const INSTALLER_ARGS = Object.freeze(['/S', '--updated', '--force-run', '/currentuser'])

// The argv marker the relaunched app receives after a successful silent install
// (consequence (d) of --updated). Recovery may READ it for a better log line but
// must NEVER depend on it: the user can also start the app by hand, from a
// shortcut, or after a reboot — in all of which the marker is absent while the
// update very much did land.
const RELAUNCH_MARKER = '--updated'

function wasRelaunchedByInstaller(argv = process.argv) {
  return Array.isArray(argv) && argv.includes(RELAUNCH_MARKER)
}

// Windows paths compare case-insensitively; a `C:\Users\...` vs `c:\users\...`
// difference between the caller's argument and the journal is not a mismatch.
function samePath(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const left = path.resolve(a)
  const right = path.resolve(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

// Stream the file rather than readFileSync: the installer is ~100 MB and this
// runs on the UI process's event loop right before the app quits.
function digestFileSha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(file)
    stream.on('error', reject)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

// Lazy Electron/runtime defaults — required only when the caller did not inject
// a fake, so `require('./companion-apply.cjs')` stays safe under vitest.
function defaultApp() {
  return require('electron').app
}
function defaultStopForeground() {
  return require('./runtime.cjs').stopHermes()
}
function defaultFullHealth(command) {
  return require('./hermes-health.cjs').assertFullHealth(command)
}
// The gateway-only half of the health gate, used as the READINESS signal of the
// bounded settle wait below. Deliberately the SAME assertion hermes-health.cjs
// makes — not a parallel "is it up yet?" format — so the thing we wait for is
// exactly the thing that later decides the outcome.
function defaultAssertGatewayDeep(command) {
  return require('./hermes-health.cjs').assertGatewayDeepHealthy(command)
}
// The wait LOOP itself is shared infrastructure and lives in hermes-health.cjs,
// beside the assertion it polls — see the long note there for why (both launch
// -time recovery paths race the same gateway settle, and the agent-update path
// must never depend on this companion-update module). Required lazily, like every
// other default here, so this file stays loadable under vitest.
function defaultAwaitGatewayHealth(command, options) {
  return require('./hermes-health.cjs').waitForGatewayDeepHealth(command, options)
}
// The repo's ONE gateway stop path, identical to the command update-runtime.cjs
// stopOfficialSurfaces issues before a Hermes-agent update. No parallel stop
// mechanism is invented here.
function defaultStopGateway(command) {
  return runCaptured(command, ['gateway', 'stop', '--all'], 90_000)
}

/**
 * Apply an already-downloaded, already-digest-verified companion update.
 *
 * @param {{ installerPath: string, targetVersion: string }} request
 * @param {object} deps injectable collaborators (see destructuring below)
 * @returns {Promise<{ ok: true, launched: true, installerPath: string, targetVersion: string, args: string[] }>}
 * Throws (Hebrew, user-facing) on every abort. An abort NEVER leaves the
 * installer spawned: each gate below runs strictly before the spawn.
 */
async function applyCompanionUpdate(request = {}, deps = {}) {
  const {
    readJournal = readCompanionJournal,
    updatePhase = updateCompanionPhase,
    recordFailure = recordCompanionFailure,
    validate = validateCompanionJournalRecord,
    exists = fs.existsSync,
    digestFile = digestFileSha256,
    spawn = childProcess.spawn,
    resolveCommand = findHermes,
    stopGateway = defaultStopGateway,
    gatewayState = officialGatewayState,
    stopForeground = defaultStopForeground,
    app = null,
    log = rememberLog
  } = deps

  const { installerPath, targetVersion } = request

  // ── Gate 1: the journal is the authority for what we are allowed to launch ──
  // The caller passes the path/version it thinks it downloaded; the durable
  // record says what was actually verified. They must AGREE, and the record must
  // pass the trust gate. A disagreement means two update flows raced or the
  // record was tampered with — either way we do not launch anything.
  const record = readJournal()
  if (!record) {
    throw new Error('לא נמצא רישום עדכון פעיל; ההתקנה בוטלה. נסה להוריד את העדכון שוב.')
  }
  const validation = validate(record)
  if (!validation.valid) {
    throw new Error(`רישום העדכון פגום (${validation.code}); ההתקנה בוטלה. נסה להוריד את העדכון שוב.`)
  }
  if (!samePath(record.installerPath, installerPath)) {
    throw new Error('קובץ ההתקנה שהתבקש אינו הקובץ שאומת; ההתקנה בוטלה.')
  }
  if (record.targetVersion !== targetVersion) {
    throw new Error('גרסת היעד שהתבקשה אינה הגרסה שאומתה; ההתקנה בוטלה.')
  }

  // ── Gate 2: TOCTOU re-verification, immediately before launch ───────────────
  // The installer sat on disk between the download-time verification and this
  // moment (possibly across a reboot, with the file living in a user-writable
  // directory). Re-hash it NOW: this is the last instant at which we can still
  // refuse, and after the spawn nothing we do can matter.
  if (!exists(record.installerPath)) {
    recordFailure(new Error(`installer missing at apply time: ${record.installerPath}`))
    throw new Error('קובץ ההתקנה של העדכון נמחק; ההתקנה בוטלה. נסה להוריד את העדכון שוב.')
  }
  let digest
  try {
    digest = await digestFile(record.installerPath)
  } catch (error) {
    recordFailure(error)
    throw new Error(`לא ניתן לקרוא את קובץ ההתקנה של העדכון; ההתקנה בוטלה. פרטים: ${error.message || error}`)
  }
  if (digest !== record.installerSha256) {
    recordFailure(new Error(`installer digest changed on disk: ${digest} != ${record.installerSha256}`))
    log(`Companion update aborted: installer digest changed on disk before apply (${record.installerPath})`)
    throw new Error('קובץ ההתקנה של העדכון השתנה מאז האימות; ההתקנה בוטלה מטעמי בטיחות.')
  }

  // ── Gate 3: journal `applying` DURABLY, before any mutation ────────────────
  // An unjournalled update is unrecoverable: the installer kills us silently, so
  // if the next launch finds no `applying` record it has no way to know an
  // install was ever attempted, which version to expect, or which installer file
  // to keep/delete. The write is fsync'd AND read back — a write that cannot be
  // proven to be on disk is treated exactly like a failed one, and we abort
  // BEFORE stopping anything or spawning anything.
  try {
    updatePhase('applying', { appliedAt: new Date().toISOString() }, { durable: true })
    const persisted = readJournal()
    if (!persisted || persisted.phase !== 'applying') {
      throw new Error('journal did not read back as phase=applying')
    }
  } catch (error) {
    log(`Companion update aborted: durable journal write failed (${error.message || error})`)
    throw new Error(
      `לא ניתן לשמור את רישום העדכון באופן עמיד; ההתקנה בוטלה כדי שלא להתקין ללא אפשרות שחזור. פרטים: ${error.message || error}`
    )
  }

  // ── Ordered shutdown of Hermes: gateway first, then the foreground process ──
  // The background gateway does NOT live under the companion's $INSTDIR, so the
  // installer will not kill it for us and it would keep running against a
  // half-replaced app. It is stopped through the repo's existing lifecycle
  // command (`gateway stop --all`), then confirmed with the AUTHORITATIVE
  // `gateway status` reader. Neither failure aborts the update: the journal is
  // already `applying`, the gateway is not a precondition for replacing our own
  // files, and aborting here would leave a journalled-but-unattempted state that
  // is strictly worse. Both are logged honestly instead.
  const command = resolveCommand()
  if (command) {
    try {
      await stopGateway(command)
    } catch (error) {
      log(`Gateway stop before companion update returned: ${error.message || error}`)
    }
    try {
      const state = gatewayState({ command })
      if (state.state !== 'stopped') {
        log(`Gateway still reports "${state.state}" after stop; continuing with the companion update`)
      }
    } catch (error) {
      log(`Gateway state probe after stop failed: ${error.message || error}`)
    }
  } else {
    log('Hermes binary not found; skipping gateway stop before the companion update')
  }
  try {
    await stopForeground()
  } catch (error) {
    log(`Foreground Hermes stop before companion update returned: ${error.message || error}`)
  }

  // ── Spawn the installer and let go of it ───────────────────────────────────
  // detached + stdio:'ignore' + unref(): the child must outlive us, must not
  // hold our pipes open, and must not be awaited — the installer's KILL_PROCESS
  // sweep is about to terminate this very process.
  let child
  try {
    child = spawn(record.installerPath, [...INSTALLER_ARGS], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
  } catch (error) {
    recordFailure(error)
    log(`Companion installer spawn failed: ${error.message || error}`)
    throw new Error(`הפעלת קובץ ההתקנה נכשלה; ההתקנה בוטלה. פרטים: ${error.message || error}`)
  }
  // A detached child's 'error' event with no listener becomes an uncaught
  // exception. We cannot act on it (we are quitting), but we must not crash on
  // the way out; the next launch reconciles the outcome from the journal.
  if (child && typeof child.on === 'function') {
    child.on('error', error => log(`Companion installer process error: ${error.message || error}`))
  }
  if (child && typeof child.unref === 'function') child.unref()
  log(`Companion installer launched for ${record.targetVersion}: ${record.installerPath} ${INSTALLER_ARGS.join(' ')}`)

  // ── Quit so the installer's grace sleep (--updated) finds us gone ──────────
  try {
    const electronApp = app || defaultApp()
    electronApp.quit()
  } catch (error) {
    // The installer is already running and will kill us anyway; the journal is
    // `applying`, so the next launch still reconciles correctly.
    log(`app.quit() after launching the companion installer failed: ${error.message || error}`)
  }

  return {
    ok: true,
    launched: true,
    installerPath: record.installerPath,
    targetVersion: record.targetVersion,
    args: [...INSTALLER_ARGS]
  }
}

// ── This call site's budget for the shared gateway settle wait ───────────────
// The race, the measurements behind it and the mechanism are documented on
// waitForGatewayDeepHealth in hermes-health.cjs. What belongs HERE is only how
// much this particular gate is willing to wait, and why:
//   * 120 s is ~7.5x the 15-16 s settle measured live on this exact path
//     (alpha.9 → alpha.10, twice; the gate sampled ~10 s after the gateway
//     process started and missed state='running' by 4.9 s and 6.1 s). The margin
//     is not padding: the settle is dominated by a NETWORK-bound platform connect
//     that retries up to 8 times, so its tail is far longer than its median.
//   * 120 s is also exactly the timeout hermes-health.cjs already grants this same
//     `gateway status --deep` command, and well under the 180 s gateway-ensure.cjs
//     grants `gateway install --start-now` — this repo already agrees that a
//     gateway may take minutes.
//   * 5 s is a real poll, not a busy loop: one `gateway status --deep` costs ~5.7 s
//     of Python CLI startup measured on this machine, so the effective cadence is
//     ~11 s and the wait costs ~11 probes at worst.
//   * What this wait can cost: it only runs after an update actually landed (phase
//     `applying` + running version == target), at most once per update, and only
//     AFTER createWindow() — the UI is already on screen, so the app cannot feel
//     hung. What NOT waiting cost: every successful update was reported to the
//     owner as "עודכן ... אך בדיקות הבריאות נכשלות", the journal was never cleared,
//     the ~104 MB consumed installer was never deleted, and no `applied` entry was
//     ever archived to history.
const HEALTH_WAIT_DEADLINE_MS = 120_000
const HEALTH_WAIT_POLL_MS = 5_000

/**
 * Launch-time reconciliation of a companion update that never reported back.
 *
 * Runs on app readiness. NEVER throws into the launch path — every branch (and
 * every unexpected error) resolves to a structured
 * `{ outcome, detail?, resumable?, ... }`:
 *
 *   none              — no journal; nothing happened.
 *   discarded-partial — `downloading`/`verifying`: no mutation ever occurred, so
 *                       the partial download is deleted and the journal cleared.
 *                       Silent, not an error.
 *   resumable         — `ready`: verified but never applied. The installer is
 *                       KEPT (it is still valid) and reported so the UI can offer
 *                       to resume. Never auto-applied — this ran without consent.
 *   applied           — `applying` + the running version IS the target AND both
 *                       health proofs pass (after a bounded wait for the gateway
 *                       to finish coming up). Journal cleared, installer deleted.
 *   applied-unhealthy — `applying` + right version but a health proof still failed
 *                       once that wait's deadline expired. We do NOT claim success
 *                       and we do NOT clear the journal.
 *   apply-failed      — `applying` + still the OLD version: the silent install
 *                       failed or its UAC/retry dialog was cancelled. Journal
 *                       cleared, installer KEPT for a manual retry.
 *   unexpected-version— `applying` + some third version: fail closed, mutate
 *                       nothing at all (not even the journal) and say so.
 *   malformed         — the record failed the trust gate; its installerPath was
 *                       already stripped, so there is nothing safe to delete.
 *   unknown-phase     — defensive: a phase with no branch. Mutates nothing.
 *   recovery-failed   — an unexpected error (e.g. an unverifiable journal clear)
 *                       turned into a value instead of an exception.
 */
async function recoverIncompleteCompanionUpdate(deps = {}) {
  const {
    detect = detectIncompleteCompanionUpdate,
    clear = clearCompanionJournal,
    recordFailure = recordCompanionFailure,
    removeFile = (file) => fs.rmSync(file, { force: true }),
    resolveCommand = findHermes,
    fullHealth = defaultFullHealth,
    // The bounded settle wait and everything it needs, injectable down to the
    // clock and the sleep so the ordering AND the bounds are testable without a
    // test ever actually waiting.
    awaitGatewayHealth = defaultAwaitGatewayHealth,
    assertGatewayDeep = defaultAssertGatewayDeep,
    // No default: an uninjected `sleep` stays undefined and the shared helper
    // falls back to its own real setTimeout. Tests inject a fake clock instead.
    sleep,
    now = Date.now,
    healthWaitDeadlineMs = HEALTH_WAIT_DEADLINE_MS,
    healthPollIntervalMs = HEALTH_WAIT_POLL_MS,
    app = null,
    argv = process.argv,
    log = rememberLog
  } = deps

  let record = null
  try {
    record = detect()
    if (!record) return { outcome: 'none' }

    // Tolerated, never depended on: a nice log line when the installer relaunched
    // us, and nothing at all when the user started the app by hand.
    if (wasRelaunchedByInstaller(argv)) log('App was relaunched by the companion installer (--updated)')

    if (record.malformed) {
      // installerPath was stripped by the trust gate, so there is no path we are
      // willing to delete. Clear the record (it can drive nothing) and be honest.
      log(`Companion update journal is malformed (${record.invalidCode}); clearing without touching any file`)
      clear({ outcome: 'malformed' })
      return {
        outcome: 'malformed',
        detail: 'רישום עדכון פגום נמצא ונוקה; אם עדכון היה בעיצומו, הורד אותו שוב.',
        resumable: false
      }
    }

    if (record.phase === 'downloading' || record.phase === 'verifying') {
      // Nothing was ever installed: the bytes on disk are a partial/unverified
      // download and are worth nothing. Deleting them is best-effort — a locked
      // temp file must not keep the journal alive forever.
      try {
        removeFile(record.installerPath)
      } catch (error) {
        log(`Could not delete the partial companion download ${record.installerPath}: ${error.message || error}`)
      }
      clear({ outcome: 'discarded-partial' })
      return { outcome: 'discarded-partial', resumable: false }
    }

    if (record.phase === 'ready') {
      // Verified and still valid, but the user never consented to apply it (or we
      // crashed before they did). Keep the file, clear the journal, and let the
      // UI offer to resume. Auto-applying here would install software the user
      // never approved in this session.
      clear({ outcome: 'ready-not-applied' })
      return {
        outcome: 'resumable',
        resumable: true,
        installerPath: record.installerPath,
        targetVersion: record.targetVersion,
        detail: `העדכון לגרסה ${record.targetVersion} הורד ואומת אך לא הותקן.`
      }
    }

    if (record.phase !== 'applying') {
      // Unreachable while PHASES and the branches above agree (an unknown phase
      // is already rejected by the trust gate and lands in `malformed`). Kept so
      // that ADDING a phase without adding a branch fails closed and mutates
      // nothing, instead of silently falling through to the version comparison.
      return { outcome: 'unknown-phase', detail: `שלב עדכון לא מוכר: ${record.phase}`, resumable: false }
    }

    // ── applying: the installer WAS launched. Decide by the RUNNING version ───
    const electronApp = app || defaultApp()
    const running = electronApp.getVersion()
    const isTarget = compareSemver(running, record.targetVersion) === 0
    const isPrevious = compareSemver(running, record.currentVersion) === 0

    if (isTarget) {
      // The install landed. Success is still NOT reportable on a version string
      // alone: this repo's hermes-update-flow.cjs holds the line that nothing is
      // ever called "updated successfully" without BOTH the foreground serve
      // health and the `gateway status --deep` process-liveness proof, and an
      // updated companion that cannot bring Hermes back up is not a success.
      const command = resolveCommand()
      if (!command) {
        recordFailure(new Error('Hermes binary not found while verifying an applied companion update'))
        return {
          outcome: 'applied-unhealthy',
          resumable: false,
          targetVersion: record.targetVersion,
          detail: `תכל'ס עודכן לגרסה ${record.targetVersion}, אך Hermes אינו מותקן ולא ניתן לאמת שהמערכת פועלת.`
        }
      }
      // Give the freshly-restarted gateway a bounded chance to finish coming up
      // before the gate samples it — see the long note above HEALTH_WAIT_*: the
      // gate used to sample ~10 s after the gateway process started, and the
      // gateway needs ~15-16 s to write gateway_state.json state='running'
      // (probe [5]). This wait removes that race; it does NOT relax the gate.
      // Its result is advisory ONLY: whether it succeeded or timed out, the
      // composed health gate below runs exactly once and its verdict alone
      // decides. A gateway that is genuinely dead therefore still ends in
      // `applied-unhealthy`, with the same recorded failure and the same
      // preserved journal — it just takes the full deadline to say so.
      const settle = await awaitGatewayHealth(command, {
        assertGatewayDeep,
        sleep,
        now,
        deadlineMs: healthWaitDeadlineMs,
        pollMs: healthPollIntervalMs,
        log
      })
      if (!settle.healthy) {
        log(
          `Gateway still not deep-healthy ${settle.waitedMs}ms after an applied companion update; running the health gate anyway`
        )
      }
      try {
        await fullHealth(command)
      } catch (error) {
        // Journal deliberately PRESERVED: the state is unresolved, so the next
        // launch re-checks instead of forgetting that this happened.
        recordFailure(error)
        log(`Companion update to ${record.targetVersion} landed but health verification failed: ${error.message || error}`)
        return {
          outcome: 'applied-unhealthy',
          resumable: false,
          targetVersion: record.targetVersion,
          detail: `תכל'ס עודכן לגרסה ${record.targetVersion}, אך בדיקות הבריאות נכשלות: ${error.message || error}`
        }
      }
      clear({ outcome: 'applied' })
      // Only now is the installer provably consumed and safe to delete.
      try {
        removeFile(record.installerPath)
      } catch (error) {
        log(`Could not delete the consumed companion installer ${record.installerPath}: ${error.message || error}`)
      }
      log(`Companion update to ${record.targetVersion} verified healthy; journal cleared`)
      return { outcome: 'applied', resumable: false, targetVersion: record.targetVersion }
    }

    if (isPrevious) {
      // Still the old version ⇒ the silent install failed or was cancelled (the
      // generated script's /SD IDCANCEL + nevershow means there is no log and no
      // exit code to consult — the version IS the evidence). Keep the installer:
      // it is still digest-valid and a manual double-click is the honest retry.
      clear({ outcome: 'apply-failed' })
      return {
        outcome: 'apply-failed',
        resumable: true,
        targetVersion: record.targetVersion,
        installerPath: record.installerPath,
        detail: `העדכון לגרסה ${record.targetVersion} לא הותקן. קובץ ההתקנה נשמר: ${record.installerPath} — אפשר להריץ אותו ידנית.`
      }
    }

    // Neither the target nor the version we started from. Something we did not
    // do changed this install (a manual install of a third version, a restore, a
    // downgrade). We cannot prove what happened, so we guess NOTHING and mutate
    // NOTHING — not the journal, not the installer file.
    const runningLabel = parseSemver(running) ? running : JSON.stringify(running)
    recordFailure(new Error(`unexpected running version ${runningLabel} (expected ${record.targetVersion} or ${record.currentVersion})`))
    return {
      outcome: 'unexpected-version',
      resumable: false,
      targetVersion: record.targetVersion,
      detail: `מצב עדכון לא צפוי: הגרסה הפועלת היא ${runningLabel} ולא ${record.targetVersion} או ${record.currentVersion}. לא בוצעה שום פעולה אוטומטית.`
    }
  } catch (error) {
    // Launch-path contract: never throw. An unexpected failure here (an
    // unverifiable journal clear, an fs error) is reported, not propagated.
    log(`Companion update recovery failed: ${error.message || error}`)
    return {
      outcome: 'recovery-failed',
      resumable: false,
      detail: `שחזור מצב העדכון נכשל: ${error.message || error}`
    }
  }
}

module.exports = {
  INSTALLER_ARGS,
  RELAUNCH_MARKER,
  HEALTH_WAIT_DEADLINE_MS,
  HEALTH_WAIT_POLL_MS,
  wasRelaunchedByInstaller,
  digestFileSha256,
  applyCompanionUpdate,
  recoverIncompleteCompanionUpdate
}
