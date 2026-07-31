const { state } = require('./window-state.cjs')

// Always-on-top handling for the mini companion window, plus a small surface
// refresh. On Windows an Electron window created as always-on-top can report the
// flag as false until it is toggled once after becoming visible, so we reassert.

function applyMiniPin() {
  const { mainWindow } = state
  if (!mainWindow || mainWindow.isDestroyed() || state.windowMode !== 'mini') return
  if (state.miniPinTimer) {
    clearTimeout(state.miniPinTimer)
    state.miniPinTimer = null
  }
  if (!state.miniPinned) {
    mainWindow.setAlwaysOnTop(false)
    return
  }
  if (!mainWindow.isAlwaysOnTop()) mainWindow.setAlwaysOnTop(false)
  mainWindow.setAlwaysOnTop(true, 'normal')
  const target = mainWindow
  state.miniPinTimer = setTimeout(() => {
    state.miniPinTimer = null
    if (!target || target.isDestroyed() || target !== state.mainWindow || state.windowMode !== 'mini' || !state.miniPinned) {
      return
    }
    if (!target.isAlwaysOnTop()) {
      target.setAlwaysOnTop(false)
      target.setAlwaysOnTop(true, 'normal')
    }
  }, 150)
}

function refreshWindowSurface() {
  const target = state.mainWindow
  setTimeout(() => {
    if (!target || target.isDestroyed() || target.webContents.isDestroyed()) return
    target.webContents.invalidate()
  }, 60)
}

module.exports = { applyMiniPin, refreshWindowSurface }
