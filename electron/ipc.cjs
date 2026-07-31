const { ipcMain, dialog, shell } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const {
  refreshRuntimeInstalled,
  startHermes,
  restartHermes,
  hermesApi,
  getVersions,
  baseUrl
} = require('./runtime.cjs')
const { recentLogs } = require('./logs.cjs')
const { createDiagnosticsBundle } = require('./diagnostics.cjs')
const {
  startGoogleSetup,
  finishGoogleSetup,
  getGoogleStatus,
  ensureGatewayBackground
} = require('./google-setup.cjs')
const { installDesktopPlugin, stageBusinessBootstrap } = require('./plugin-install.cjs')
const { findHermes, hermesHome } = require('./paths.cjs')
const { runCaptured } = require('./process-util.cjs')
const {
  getMainWindow,
  currentWindowState,
  setWindowMode,
  setMiniPinned,
  hideAssistant
} = require('./windows.cjs')

// Single place that maps every renderer IPC channel to a module function. Keeps
// the wiring auditable and the feature modules free of Electron IPC concerns.
function registerIpc() {
  ipcMain.handle('hermes:runtime', async () => refreshRuntimeInstalled())
  ipcMain.handle('hermes:start', startHermes)
  ipcMain.handle('hermes:restart', restartHermes)
  ipcMain.handle('hermes:api', (_event, endpoint, init) => hermesApi(endpoint, init))
  ipcMain.handle('hermes:versions', getVersions)
  ipcMain.handle('hermes:logs', () => ({ lines: recentLogs(250) }))
  ipcMain.handle('hermes:diagnostics', createDiagnosticsBundle)
  ipcMain.handle('hermes:choose-file', async (_event, filters) => {
    const result = await dialog.showOpenDialog(getMainWindow(), { properties: ['openFile'], filters: filters || [] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('hermes:google:start', (_event, clientSecretPath, services) =>
    startGoogleSetup(clientSecretPath, services)
  )
  ipcMain.handle('hermes:google:finish', (_event, code) => finishGoogleSetup(code))
  ipcMain.handle('hermes:google:status', getGoogleStatus)
  ipcMain.handle('hermes:open-external', (_event, url) => shell.openExternal(url))
  ipcMain.handle('hermes:open-full', async (_event, surface) => {
    const command = findHermes()
    if (surface === 'desktop' && command) {
      const child = spawn(command, ['desktop'], { detached: true, stdio: 'ignore', windowsHide: true })
      child.unref()
      return { ok: true }
    }
    if (surface === 'logs') {
      const logPath = path.join(hermesHome(), 'logs')
      fs.mkdirSync(logPath, { recursive: true })
      await shell.openPath(logPath)
      return { ok: true }
    }
    if (surface === 'settings') {
      await shell.openExternal(`${baseUrl()}/settings`)
      return { ok: true }
    }
    await shell.openExternal(baseUrl())
    return { ok: true }
  })
  ipcMain.handle('hermes:install', async () => {
    if (findHermes()) {
      installDesktopPlugin()
      await ensureGatewayBackground()
      return { ok: true, installed: true }
    }
    const stagingRoot = stageBusinessBootstrap()
    try {
      await runCaptured(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy', 'Bypass',
          '-File', path.join(stagingRoot, 'bootstrap.ps1'),
          '-PayloadRoot', stagingRoot,
          '-NoLaunch'
        ],
        45 * 60_000
      )
    } finally {
      fs.rmSync(stagingRoot, { recursive: true, force: true })
    }
    const installed = Boolean(findHermes())
    return { ok: installed, installed, code: installed ? 0 : 1 }
  })
  ipcMain.handle('assistant:window-state', () => currentWindowState())
  ipcMain.handle('assistant:set-window-mode', (_event, mode) => setWindowMode(mode))
  ipcMain.handle('assistant:set-always-on-top', (_event, value) => setMiniPinned(value))
  ipcMain.handle('assistant:hide', () => hideAssistant())
}

module.exports = { registerIpc }
