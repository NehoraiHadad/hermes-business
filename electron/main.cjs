const { app, BrowserWindow } = require('electron')
const lifecycle = require('./lifecycle-state.cjs')
const { rememberLog } = require('./logs.cjs')
const { loadWindowPreferences, createWindow, createTray, showAssistant } = require('./windows.cjs')
const { startHermes, stopHermes, hasRunningProcess } = require('./runtime.cjs')
const { installDesktopPlugin } = require('./plugin-install.cjs')
const { ensureGatewayBackground } = require('./google-setup.cjs')
const { registerIpc } = require('./ipc.cjs')

// Application entry point. Owns only process lifecycle; every feature lives in a
// dedicated module (runtime, windows, ipc, google-setup, plugin-install,
// diagnostics). Behaviour and security settings match the original single file.

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showAssistant()
  })
}

app.whenReady().then(async () => {
  if (!singleInstance) return
  loadWindowPreferences()
  registerIpc()
  installDesktopPlugin()
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
