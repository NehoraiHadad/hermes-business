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
const { reconcilePartnerCheckinsOnStartup } = require('./business-partner.cjs')
const { registerIpc } = require('./ipc.cjs')
const { getRuntimeMode } = require('./runtime-mode.cjs')
const { recordQaNamespaceApplied } = require('./qa-diagnostics.cjs')
const { checkCompanionUpdate, isPassiveUpdateCheckDisabled, getLastCheckedAt } = require('./companion-update.cjs')

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

// Passive companion self-update check timing (docs/specs/versioning.md §6.5): a
// 60s post-ready delay and a 24h durable throttle. Named constants rather than
// inline literals so the intent reads at the call site below.
const PASSIVE_COMPANION_UPDATE_DELAY_MS = 60_000
const PASSIVE_COMPANION_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000

// Runs the passive companion self-update check: skips entirely when disabled
// (QA runtime override / TACHLES_DISABLE_UPDATE_CHECK — keeps the isolated
// packaged E2E hermetic, R7) or when the durable last-check timestamp is still
// fresh, then delegates to the SAME checkCompanionUpdate the explicit button
// uses (fail-closed contract: never rejects). On `update-available` only, pushes
// a ONE-SHOT event to the renderer so the support screen can show it without a
// boot-time GitHub round trip; every other verdict is silently absorbed — the
// passive path never surfaces "unknown"/"up-to-date" unprompted.
async function runPassiveCompanionUpdateCheck() {
  if (isPassiveUpdateCheckDisabled(process.env)) return
  const lastCheckedAt = getLastCheckedAt()
  if (typeof lastCheckedAt === 'number' && Date.now() - lastCheckedAt < PASSIVE_COMPANION_UPDATE_INTERVAL_MS) return
  const verdict = await checkCompanionUpdate({ force: false })
  if (verdict.status !== 'update-available') return
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('hermes:companion-update-available', verdict)
  }
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
  // Passive תכל'ס (companion) self-update check (docs/specs/versioning.md §6.5):
  // fired 60s after ready so it never competes with the Hermes startup sequence
  // above, and only when the durable throttle (companion-update-state.json) shows
  // the last successful check is more than 24h old — a plain local read, no
  // network call just to decide whether to check. Never blocks/awaited here;
  // any failure is caught and logged, never surfaced as a startup failure.
  setTimeout(() => {
    runPassiveCompanionUpdateCheck().catch(error => {
      rememberLog(`Passive companion update check failed: ${error.message || error}`)
    })
  }, PASSIVE_COMPANION_UPDATE_DELAY_MS)
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
  if (lifecycle.quitting) return
  lifecycle.quitting = true
  if (hasRunningProcess()) {
    event.preventDefault()
    void stopHermes().finally(() => app.quit())
  }
})
