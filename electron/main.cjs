const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const lifecycle = require('./lifecycle-state.cjs')
const { rememberLog } = require('./logs.cjs')
const { loadWindowPreferences, createWindow, createTray, showAssistant } = require('./windows.cjs')
const { startHermes, stopHermes, hasRunningProcess } = require('./runtime.cjs')
const { installDesktopPlugin } = require('./plugin-install.cjs')
const { installWhatsappPolicyPlugin } = require('./whatsapp-plugin-install.cjs')
const { ensureGatewayBackground } = require('./google-setup.cjs')
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
  try {
    const policyPlugin = installWhatsappPolicyPlugin()
    if (!policyPlugin.ok || !policyPlugin.enabled) {
      rememberLog(`WhatsApp policy plugin not fully active: ${policyPlugin.error || policyPlugin.reason || 'unknown'}`)
    }
  } catch (error) {
    rememberLog(`WhatsApp policy plugin install failed: ${error.message || error}`)
  }
  createWindow()
  createTray()
  try {
    await ensureGatewayBackground()
  } catch (error) {
    rememberLog(`Gateway background setup failed: ${error.message || error}`)
  }
  await startHermes()
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
