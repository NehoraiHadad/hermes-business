const { screen } = require('electron')
const { state, loadWindowPreferences, saveWindowPreferences, currentWindowState } = require('./window-state.cjs')
const { applyMiniPin, refreshWindowSurface } = require('./window-pin.cjs')
const { createTray, createWindow } = require('./window-create.cjs')

// Window controller: mode/pin transitions and show/hide behavior. The mini window
// is a small always-on-top companion; the full window is the standard desktop app.
// Shared state and preferences live in window-state.cjs; construction in
// window-create.cjs; always-on-top handling in window-pin.cjs.

const getMainWindow = () => state.mainWindow

function setWindowMode(mode) {
  const { mainWindow } = state
  if (!mainWindow || mainWindow.isDestroyed()) return currentWindowState()
  const nextMode = mode === 'mini' ? 'mini' : 'full'
  if (nextMode === state.windowMode) {
    mainWindow.show()
    mainWindow.focus()
    if (nextMode === 'mini') applyMiniPin()
    refreshWindowSurface()
    return currentWindowState()
  }
  if (nextMode === 'mini') {
    const enteringMini = state.windowMode !== 'mini'
    if (enteringMini) state.normalBounds = mainWindow.getBounds()
    state.windowMode = 'mini'
    mainWindow.setSkipTaskbar(true)
    mainWindow.setMinimumSize(340, 440)
    mainWindow.setMaximumSize(620, 900)
    mainWindow.setMaximizable(false)
    if (enteringMini) {
      const workArea = screen.getDisplayMatching(mainWindow.getBounds()).workArea
      const width = Math.min(390, workArea.width)
      const height = Math.min(640, workArea.height)
      mainWindow.setBounds({
        x: workArea.x + workArea.width - width - 18,
        y: workArea.y + workArea.height - height - 18,
        width,
        height
      })
    }
  } else {
    state.windowMode = 'full'
    mainWindow.setSkipTaskbar(false)
    mainWindow.setAlwaysOnTop(false)
    mainWindow.setMaximumSize(0, 0)
    mainWindow.setMinimumSize(1100, 720)
    mainWindow.setMaximizable(true)
    if (state.normalBounds) mainWindow.setBounds(state.normalBounds)
    else {
      mainWindow.setSize(1440, 920)
      mainWindow.center()
    }
  }
  mainWindow.show()
  mainWindow.focus()
  if (nextMode === 'mini') applyMiniPin()
  refreshWindowSurface()
  saveWindowPreferences()
  return currentWindowState()
}

function setMiniPinned(value) {
  state.miniPinned = Boolean(value)
  if (state.mainWindow && !state.mainWindow.isDestroyed() && state.windowMode === 'mini') {
    applyMiniPin()
  }
  saveWindowPreferences()
  return currentWindowState()
}

function showAssistant(mode = state.windowMode) {
  const { mainWindow } = state
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  state.assistantHidden = false
  if (state.hiddenBounds) {
    mainWindow.setBounds(state.hiddenBounds)
    state.hiddenBounds = null
  }
  mainWindow.setIgnoreMouseEvents(false)
  if (mainWindow.isMinimized()) mainWindow.restore()
  setWindowMode(mode)
  mainWindow.show()
  mainWindow.focus()
}

function hideAssistant() {
  const { mainWindow } = state
  if (!mainWindow || mainWindow.isDestroyed()) return currentWindowState()
  state.assistantHidden = true
  if (state.miniPinTimer) {
    clearTimeout(state.miniPinTimer)
    state.miniPinTimer = null
  }
  state.hiddenBounds = mainWindow.getBounds()
  const workArea = screen.getDisplayMatching(state.hiddenBounds).workArea
  mainWindow.setAlwaysOnTop(false)
  mainWindow.setIgnoreMouseEvents(true)
  mainWindow.setPosition(workArea.x + workArea.width + 100, workArea.y, false)
  mainWindow.blur()
  return currentWindowState()
}

module.exports = {
  getMainWindow,
  loadWindowPreferences,
  saveWindowPreferences,
  currentWindowState,
  setWindowMode,
  setMiniPinned,
  showAssistant,
  hideAssistant,
  createTray,
  createWindow
}
