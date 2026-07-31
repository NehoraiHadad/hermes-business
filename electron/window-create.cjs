const { app, BrowserWindow, Menu, Tray, nativeImage, screen } = require('electron')
const path = require('node:path')
const { state } = require('./window-state.cjs')
const { applyMiniPin, refreshWindowSurface } = require('./window-pin.cjs')

// Construction of the tray and the BrowserWindow itself. Runtime callbacks reach
// back into the window controller lazily to avoid a require cycle with windows.cjs.

function createTray() {
  if (state.tray) return
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'build', 'icon.png'))
  state.tray = new Tray(icon.resize({ width: 20, height: 20 }))
  state.tray.setToolTip('העוזר לעסק')
  const { showAssistant } = require('./windows.cjs')
  state.tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'פתח את העוזר', click: () => showAssistant(state.windowMode) },
      { label: 'צ׳אט קטן', click: () => showAssistant('mini') },
      { label: 'חלון מלא', click: () => showAssistant('full') },
      { type: 'separator' },
      { label: 'יציאה', click: () => app.quit() }
    ])
  )
  state.tray.on('click', () => {
    const { showAssistant: show, hideAssistant } = require('./windows.cjs')
    if (state.mainWindow && state.mainWindow.isVisible() && !state.assistantHidden) hideAssistant()
    else show(state.windowMode)
  })
}

function createWindow() {
  const mini = state.windowMode === 'mini'
  const miniWorkArea = mini ? screen.getPrimaryDisplay().workArea : null
  const miniWidth = mini ? Math.min(390, miniWorkArea.width) : null
  const miniHeight = mini ? Math.min(640, miniWorkArea.height) : null
  const mainWindow = new BrowserWindow({
    width: mini ? miniWidth : state.normalBounds?.width || 1440,
    height: mini ? miniHeight : state.normalBounds?.height || 920,
    x: mini ? miniWorkArea.x + miniWorkArea.width - miniWidth - 18 : state.normalBounds?.x,
    y: mini ? miniWorkArea.y + miniWorkArea.height - miniHeight - 18 : state.normalBounds?.y,
    minWidth: mini ? 340 : 1100,
    minHeight: mini ? 440 : 720,
    maxWidth: mini ? 620 : undefined,
    maxHeight: mini ? 900 : undefined,
    maximizable: !mini,
    alwaysOnTop: mini && state.miniPinned,
    skipTaskbar: mini,
    show: false,
    backgroundColor: '#f7f5ef',
    title: 'העוזר לעסק',
    icon: path.join(app.getAppPath(), 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f7f5ef', symbolColor: '#27241f', height: 46 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  state.mainWindow = mainWindow
  mainWindow.on('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.show()
    mainWindow.focus()
    if (state.windowMode === 'mini') applyMiniPin()
    refreshWindowSurface()
  })
  mainWindow.webContents.on('did-finish-load', () => {
    if (state.windowMode !== 'mini') return
    setTimeout(() => {
      if (!state.mainWindow || state.mainWindow.isDestroyed() || state.windowMode !== 'mini') return
      applyMiniPin()
    }, 500)
  })
  mainWindow.on('close', event => {
    if (require('./lifecycle-state.cjs').quitting) return
    event.preventDefault()
    require('./windows.cjs').hideAssistant()
  })
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  } else {
    mainWindow.loadURL('http://127.0.0.1:5173')
  }
}

module.exports = { createTray, createWindow }
