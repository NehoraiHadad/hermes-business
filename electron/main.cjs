const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const lifecycle = require('./lifecycle-state.cjs')
const { rememberLog } = require('./logs.cjs')
const { loadWindowPreferences, createWindow, createTray, showAssistant } = require('./windows.cjs')
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
const { getQaRuntimeOverride, SENTINEL_ENV, SENTINEL_VALUE } = require('./qa-runtime.cjs')
const { qaElectronNamespace } = require('./qa-electron-namespace.cjs')
const { recordQaNamespaceApplied } = require('./qa-diagnostics.cjs')

// Application entry point. Owns only process lifecycle; every feature lives in a
// dedicated module (runtime, windows, ipc, google-setup, plugin-install,
// diagnostics). Behaviour and security settings match the original single file.

// ── Automated-QA isolation (main-process only, fail-closed) ──────────────────
// When the QA sentinel is present the packaged app MUST run in its own Electron
// userData + single-instance namespace, rooted UNDER the validated throwaway
// HERMES_HOME and set BEFORE requestSingleInstanceLock(). This guarantees a
// running LIVE companion (which holds the default-userData single-instance lock)
// can never intercept/forward the QA launch to itself — the exact collision that
// let a QA approval run reach the live gateway. Production is untouched: with no
// sentinel, qaOverride.enabled is false, the default userData/lock is used, and
// every path below is the original behaviour.
let qaOverride = { enabled: false }
let qaFailClosed = false
if (process.env[SENTINEL_ENV] === SENTINEL_VALUE) {
  try {
    qaOverride = getQaRuntimeOverride()
  } catch (error) {
    // A QA run was REQUESTED but the isolation contract is invalid. NEVER fall
    // back to the live profile/lock — refuse to launch at all.
    qaFailClosed = true
    rememberLog(`QA isolation invalid; refusing to launch: ${error.message || error}`)
  }
  const ns = qaElectronNamespace(qaOverride)
  if (ns.isolated) {
    try {
      fs.mkdirSync(ns.userData, { recursive: true })
    } catch {
      /* Electron surfaces a userData failure on ready; we still isolate the path */
    }
    // Repartition the userData path (which KEYS the single-instance lock) before
    // any lock request, so the QA instance shares no namespace with the live
    // companion. sessionData follows userData to keep caches isolated too.
    app.setPath('userData', ns.userData)
    app.setPath('sessionData', ns.userData)
    // Record — synchronously, BEFORE the lock request below — that the QA
    // namespace was applied in THIS binary. The isolated E2E reads this back from
    // the running app (runtimeState.qa) as executable proof the fix is present,
    // rather than trusting a source inspection of a possibly-stale build.
    recordQaNamespaceApplied({
      namespaceApplied: true,
      appliedBeforeLock: true,
      isolated: true,
      userDataLeaf: ns.userData
    })
  }
}

const singleInstance = qaFailClosed
  ? false
  : app.requestSingleInstanceLock({ qa: Boolean(qaOverride.enabled) })
if (qaFailClosed || !singleInstance) {
  app.quit()
} else if (!qaOverride.enabled) {
  // Only the LIVE companion forwards a second launch to the running window. A QA
  // instance owns a private namespace and must never surface (or be surfaced by)
  // another instance.
  app.on('second-instance', () => {
    showAssistant()
  })
}

app.whenReady().then(async () => {
  if (qaFailClosed || !singleInstance) return
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
