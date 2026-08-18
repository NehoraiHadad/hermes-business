const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const lifecycle = require('./lifecycle-state.cjs')
const { rememberLog } = require('./logs.cjs')
const { loadWindowPreferences, createWindow, createTray, showAssistant, getMainWindow } = require('./windows.cjs')
const { startHermes, stopHermes, hasRunningProcess } = require('./runtime.cjs')
const { patchRuntimeState } = require('./runtime-state.cjs')
const { installDesktopPlugin } = require('./plugin-install.cjs')
const { installWhatsappPolicyPlugin } = require('./whatsapp-plugin-install.cjs')
const { activateWhatsappGuard } = require('./whatsapp-guard-activation.cjs')
const { recoverGuardActivation } = require('./whatsapp-guard-recovery.cjs')
const { officialGatewayState } = require('./gateway-status.cjs')
const { ensureGatewayBackground } = require('./google-setup.cjs')
const { recoverIncompleteUpdate } = require('./hermes-update-recovery.cjs')
const { recoverIncompleteCompanionUpdate } = require('./companion-apply.cjs')
const { reconcilePartnerCheckinsOnStartup } = require('./business-partner.cjs')
const { registerIpc } = require('./ipc.cjs')
const { getRuntimeMode } = require('./runtime-mode.cjs')
const { recordQaNamespaceApplied } = require('./qa-diagnostics.cjs')
const { checkCompanionUpdate, isPassiveUpdateCheckDisabled, getLastCheckedAt } = require('./companion-update.cjs')
const { decidePassiveCheck } = require('./companion-update-schedule.cjs')

// Application entry point. Owns only process lifecycle; every feature lives in a
// dedicated module (runtime, windows, ipc, google-setup, plugin-install,
// diagnostics). Behaviour and security settings match the original single file.

// Last-resort main-process failure capture for the diagnostics bundle.
// uncaughtExceptionMonitor observes WITHOUT changing crash behaviour (a plain
// 'uncaughtException' listener would suppress the default failure path). For
// rejections there is no monitor variant; the listener records and logs, which
// replaces Electron's default console warning with an equivalent redacted line.
const { recordAppError } = require('./error-journal.cjs')
process.on('uncaughtExceptionMonitor', error => {
  recordAppError('uncaught', error)
})
process.on('unhandledRejection', reason => {
  recordAppError('unhandled-rejection', reason)
  rememberLog(`Unhandled rejection: ${reason?.message || reason}`)
})

// ── Automated-QA isolation (main-process only, fail-closed) ──────────────────
// When the QA sentinel is present the packaged app MUST run in its own Electron
// userData + single-instance namespace, rooted UNDER the validated throwaway
// HERMES_HOME and set BEFORE requestSingleInstanceLock(). This guarantees a
// running LIVE companion (which holds the default-userData single-instance lock)
// can never intercept/forward the QA launch to itself — the exact collision that
// let a QA approval run reach the live gateway. Production is untouched: with no
// sentinel, production keeps the default userData/lock. Development and QA use
// separate namespaces before the lock is requested.
let runtimeConfig = null
let runtimeFailClosed = false
try {
  runtimeConfig = getRuntimeMode()
} catch (error) {
  runtimeFailClosed = true
  rememberLog(`Runtime mode invalid; refusing to launch: ${error.message || error}`)
}
if (runtimeConfig?.electronUserData) {
  const userData = runtimeConfig.electronUserData
  if (runtimeConfig.isolated) {
    try {
      fs.mkdirSync(userData, { recursive: true })
    } catch {
      /* Electron surfaces a userData failure on ready; we still isolate the path */
    }
    // Repartition the userData path (which KEYS the single-instance lock) before
    // any lock request, so the QA instance shares no namespace with the live
    // companion. sessionData follows userData to keep caches isolated too.
    app.setPath('userData', userData)
    app.setPath('sessionData', userData)
    // Record — synchronously, BEFORE the lock request below — that the QA
    // namespace was applied in THIS binary. The isolated E2E reads this back from
    // the running app (runtimeState.qa) as executable proof the fix is present,
    // rather than trusting a source inspection of a possibly-stale build.
    if (runtimeConfig.mode === 'qa-isolated') {
      recordQaNamespaceApplied({
        namespaceApplied: true,
        appliedBeforeLock: true,
        isolated: true,
        userDataLeaf: userData
      })
    }
  }
}

const singleInstance = runtimeFailClosed
  ? false
  : app.requestSingleInstanceLock({ runtimeMode: runtimeConfig?.mode || 'invalid' })
if (runtimeFailClosed || !singleInstance) {
  app.quit()
} else if (!runtimeConfig?.isolated) {
  // Only the LIVE companion forwards a second launch to the running window. A QA
  // instance owns a private namespace and must never surface (or be surfaced by)
  // another instance.
  app.on('second-instance', () => {
    showAssistant()
  })
}

// ── Passive companion self-update scheduling (docs/specs/versioning.md §6.5) ──
// The DECISION — may a check run now, when should we wake again — is pure and
// lives in companion-update-schedule.cjs (60s post-ready delay, 24h durable
// throttle, clock-skew and corrupt-state handling, all unit-tested). Everything
// below is the impure half only: a real timer, a real window, a real IPC push.
//
// The timer RE-ARMS itself after every run instead of being a single one-shot
// (which is what shipped before: on a tray-resident app that never quits, a
// machine left on for a fortnight performed exactly ONE check, at launch) and
// instead of a single setInterval (Windows suspends timers across
// sleep/hibernate; a 24h interval can fire once immediately on resume and then
// drift). Waking early or late is harmless: the durable lastCheckedAt gate, not
// the timer, decides whether a network call actually happens.
let passiveUpdateTimer = null
let passiveUpdateReadyAt = null
let passiveUpdateInFlight = null

function currentPassiveUpdateDecision() {
  const disabled = isPassiveUpdateCheckDisabled(process.env)
  return decidePassiveCheck({
    now: Date.now(),
    readyAt: passiveUpdateReadyAt,
    disabled,
    // A small local JSON read, skipped entirely when the check is disabled so an
    // isolated/packaged E2E run touches no companion-update state at all (R7).
    lastCheckedAt: disabled ? null : getLastCheckedAt()
  })
}

// Runs the passive companion self-update check when the pure decision allows it,
// then delegates to the SAME checkCompanionUpdate the explicit support-screen
// button uses (fail-closed contract: never rejects). On `update-available` only,
// pushes an event to the renderer so the support screen can show it without a
// boot-time GitHub round trip; every other verdict is silently absorbed — the
// passive path never surfaces "unknown"/"up-to-date" unprompted. The renderer
// side is already idempotent per target version (dismissedVersion +
// announcedVersionRef in FullAppShell.tsx), so a repeated push cannot re-nag.
async function runPassiveCompanionUpdateCheck() {
  const decision = currentPassiveUpdateDecision()
  if (!decision.check) return decision
  const verdict = await checkCompanionUpdate({ force: false })
  if (verdict.status !== 'update-available') return decision
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('hermes:companion-update-available', verdict)
  }
  return decision
}

// Single funnel for every trigger (timer tick, window show/restore/focus). The
// in-flight promise collapses the burst a single restore emits — show + restore
// + focus can all land within a few ms — into ONE check instead of three that
// would race into companion-update's serial guard and resolve as `unknown`.
// Never rejects: any failure is logged, never surfaced as a startup failure.
function triggerPassiveCompanionUpdateCheck() {
  if (passiveUpdateInFlight) return passiveUpdateInFlight
  passiveUpdateInFlight = runPassiveCompanionUpdateCheck()
    .catch(error => {
      rememberLog(`Passive companion update check failed: ${error.message || error}`)
    })
    .finally(() => {
      passiveUpdateInFlight = null
    })
  return passiveUpdateInFlight
}

function clearPassiveCompanionUpdateTimer() {
  if (!passiveUpdateTimer) return
  clearTimeout(passiveUpdateTimer)
  passiveUpdateTimer = null
}

// Arms (or re-arms) the single passive timer. `null` — the disabled branch —
// deliberately arms NOTHING, so a hermetic QA run leaves no timer behind.
function armPassiveCompanionUpdateTimer(delayMs) {
  clearPassiveCompanionUpdateTimer()
  if (typeof delayMs !== 'number' || !Number.isFinite(delayMs)) return
  passiveUpdateTimer = setTimeout(() => {
    passiveUpdateTimer = null
    void triggerPassiveCompanionUpdateCheck().then(() => {
      // Re-decide from FRESH durable state: after a check ran, lastCheckedAt has
      // moved, so the next wake naturally lands a full throttle out; after a skip
      // it lands exactly when the current throttle expires. This is the
      // self-healing property — the schedule is derived, never accumulated.
      if (lifecycle.quitting) return
      armPassiveCompanionUpdateTimer(currentPassiveUpdateDecision().nextWakeInMs)
    })
  }, delayMs)
  // Belt and braces with the before-quit clear below: an unref'd timer can never
  // hold the process open against a quit. Electron's main process is driven by
  // the platform message loop, not by a non-empty libuv handle set, so unref'ing
  // does not shorten the app's life.
  if (typeof passiveUpdateTimer.unref === 'function') passiveUpdateTimer.unref()
}

// "The user came back after days" — the case a pure timer cannot cover well on a
// tray-resident app. Registered at module load so it also covers a window the
// tray recreates after the previous one was destroyed; it stays inert until the
// scheduler starts (the decision returns `not-started` while readyAt is null)
// and through the 60s post-ready quiet period, which is what absorbs the boot's
// own show/focus. All three events are observed because none alone is reliable
// here: hideAssistant() parks the window OFF-SCREEN rather than hiding it (so
// `show` may not fire on the way back), `restore` only follows a real minimize,
// and `focus` can be refused by Windows. The burst they can form is collapsed by
// triggerPassiveCompanionUpdateCheck, and the durable throttle governs the rest —
// this is never a forced check.
if (!runtimeFailClosed && singleInstance) {
  app.on('browser-window-created', (_event, window) => {
    const onUserReturned = () => {
      void triggerPassiveCompanionUpdateCheck()
    }
    window.on('show', onUserReturned)
    window.on('restore', onUserReturned)
    window.on('focus', onUserReturned)
  })
}

app.whenReady().then(async () => {
  if (runtimeFailClosed || !singleInstance) return
  loadWindowPreferences()
  registerIpc()
  installDesktopPlugin()
  // Capture the AUTHORITATIVE official gateway process state (running/stopped/unknown) BEFORE
  // the plugin is installed and BEFORE the gateway is ensured. This is the only moment a
  // still-running OLD-code gateway is distinguishable from a newly launched post-install one —
  // and it uses the official `hermes gateway status`, not the heartbeat (an old pre-heartbeat
  // gateway publishes none). The snapshot drives whether activation must force a restart.
  const priorGatewayState = officialGatewayState().state
  // Install/enable the guard plugin BEFORE the gateway is ensured so a freshly-started
  // gateway loads it. The result (incl. `changed`) is carried to the post-runtime activation
  // transaction so we never double-install (a second install would reset `changed` to false).
  let policyPlugin = null
  try {
    policyPlugin = installWhatsappPolicyPlugin()
    if (!policyPlugin.ok || !policyPlugin.enabled) {
      rememberLog(`WhatsApp policy plugin not fully active: ${policyPlugin.error || policyPlugin.reason || 'unknown'}`)
    }
  } catch (error) {
    rememberLog(`WhatsApp policy plugin install failed: ${error.message || error}`)
  }
  createWindow()
  createTray()
  // ensureGatewayBackground reports whether it actually STARTED a fresh gateway (which would
  // have loaded the just-installed plugin) vs found one already running.
  let gatewayStartedFresh = false
  try {
    const ensure = await ensureGatewayBackground()
    gatewayStartedFresh = Boolean(ensure && ensure.startedFresh)
  } catch (error) {
    rememberLog(`Gateway background setup failed: ${error.message || error}`)
  }
  await startHermes()
  // Recover FIRST: finish any restart transaction a previous crash/quit left mid-flight BEFORE
  // activation runs. Activation can supersede or clear the journal, so recovery must complete
  // (or honestly fail) an interrupted transaction before that happens.
  try {
    const guardRecovery = await recoverGuardActivation()
    if (guardRecovery.action !== 'none') {
      rememberLog(`WhatsApp guard restart recovery on launch: ${guardRecovery.action}`)
    }
  } catch (error) {
    rememberLog(`WhatsApp guard recovery failed: ${error.message || error}`)
  }
  // Then the OBSERVABLE guard-activation transaction: if the payload CHANGED and a gateway was
  // ALREADY running the OLD code (per the pre-install snapshot), restart it via the official
  // control endpoint and reverify a FRESH heartbeat before the guard is treated active. Unknown
  // official status fails closed. Never blocks launch.
  if (policyPlugin) {
    try {
      const activation = await activateWhatsappGuard({
        install: () => policyPlugin,
        priorGatewayState,
        gatewayStartedFresh
      })
      if (!activation.active) {
        rememberLog(`WhatsApp guard not yet active (${activation.reason || activation.phase}); connections stay fail-closed`)
      }
    } catch (error) {
      rememberLog(`WhatsApp guard activation failed: ${error.message || error}`)
    }
  }
  // Deterministically recover an update interrupted by a crash/power-loss: a
  // still-present update journal is detected and either verified-healthy-cleared,
  // rolled back to the captured anchor, or left for retry with an honest error
  // surfaced to the UI. Never touches user state; never clears unless both the
  // runtime and gateway deep health pass.
  try {
    const recovery = await recoverIncompleteUpdate()
    if (recovery.action !== 'none') {
      rememberLog(`Update recovery on launch: ${recovery.action}${recovery.recovered ? '' : ' (unresolved)'}`)
      if (!recovery.recovered && recovery.message) patchRuntimeState({ error: recovery.message })
    }
  } catch (error) {
    rememberLog(`Update recovery on launch failed: ${error.message || error}`)
  }
  // Same discipline, second surface: reconcile a תכל'ס (companion) self-update that
  // was launched but never confirmed. The NSIS installer runs silently, kills this
  // very process, and reports nothing back (`/SD IDCANCEL` on its retry dialogs,
  // `ShowInstDetails nevershow`), so a launched update is UNOBSERVABLE from the
  // process that started it — the only honest place to learn the outcome is here,
  // at the next launch, by comparing the running app.getVersion() to the journal's
  // targetVersion. Contractually non-throwing; the try/catch is belt-and-braces.
  try {
    const companionRecovery = await recoverIncompleteCompanionUpdate()
    if (companionRecovery.outcome !== 'none') {
      rememberLog(`Companion update recovery on launch: ${companionRecovery.outcome}`)
      // `resumable` is not a failure — a verified installer is simply waiting for
      // the owner's consent, so it must never be surfaced as a runtime error.
      if (companionRecovery.detail && companionRecovery.outcome !== 'resumable') {
        patchRuntimeState({ error: companionRecovery.detail })
      }
    }
  } catch (error) {
    rememberLog(`Companion update recovery failed: ${error.message || error}`)
  }
  // Make the official cron store agree with the persisted partner check-in intent
  // on every launch (durable + idempotent, no parallel scheduler). Non-fatal.
  try {
    await reconcilePartnerCheckinsOnStartup()
  } catch (error) {
    rememberLog(`Partner check-in reconcile failed: ${error.message || error}`)
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  // Start the passive תכל'ס (companion) self-update schedule (§6.5). Recording
  // `ready` is all that happens here: the first wake (60s out, so it never
  // competes with the Hermes startup sequence above) comes from the same pure
  // decision every later wake does, and each run re-arms the next one for as long
  // as the app lives — which, tray-resident, can be weeks. Never blocked/awaited;
  // any failure is caught and logged, never surfaced as a startup failure.
  passiveUpdateReadyAt = Date.now()
  armPassiveCompanionUpdateTimer(currentPassiveUpdateDecision().nextWakeInMs)
}).catch(error => {
  // A rejection here previously died as a silent unhandled rejection with no
  // window. Record it durably and surface it to any UI that does come up.
  rememberLog(`Startup failed: ${error && (error.stack || error.message) || error}`)
  try {
    patchRuntimeState({ error: `Startup failed: ${error.message || error}` })
  } catch {
    /* runtime state unavailable; the log line above is the durable record */
  }
})

app.on('window-all-closed', () => {
  // The assistant remains available from the system tray until the user
  // explicitly chooses "יציאה".
})

app.on('before-quit', event => {
  // Drop the passive update timer first, unconditionally: a quit that is deferred
  // below (while Hermes stops) must not let a wake land mid-teardown and re-arm
  // itself behind the quit.
  clearPassiveCompanionUpdateTimer()
  if (lifecycle.quitting) return
  lifecycle.quitting = true
  if (hasRunningProcess()) {
    event.preventDefault()
    void stopHermes().finally(() => app.quit())
  }
})
