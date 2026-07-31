const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { rememberLog } = require('./logs.cjs')

// Shared mutable presentation state for the assistant window, plus preference
// persistence and the serialized snapshot handed to the renderer. Kept in one
// module so the window controller and creation code operate on the same state.

const state = {
  mainWindow: null,
  tray: null,
  windowMode: 'full',
  miniPinned: true,
  normalBounds: null,
  assistantHidden: false,
  hiddenBounds: null,
  miniPinTimer: null
}

function windowPreferencesPath() {
  return path.join(app.getPath('userData'), 'window-preferences.json')
}

function loadWindowPreferences() {
  try {
    const value = JSON.parse(fs.readFileSync(windowPreferencesPath(), 'utf8'))
    state.windowMode = value.mode === 'mini' ? 'mini' : 'full'
    state.miniPinned = value.miniPinned !== false
    if (value.normalBounds && Number.isFinite(value.normalBounds.width) && Number.isFinite(value.normalBounds.height)) {
      state.normalBounds = value.normalBounds
    }
  } catch {
    // First run or an invalid preference file: use friendly defaults.
  }
}

function saveWindowPreferences() {
  try {
    fs.mkdirSync(path.dirname(windowPreferencesPath()), { recursive: true })
    fs.writeFileSync(
      windowPreferencesPath(),
      JSON.stringify({ mode: state.windowMode, miniPinned: state.miniPinned, normalBounds: state.normalBounds }, null, 2),
      'utf8'
    )
  } catch (error) {
    rememberLog(`Could not save window preferences: ${error.message || error}`)
  }
}

function currentWindowState() {
  const { mainWindow, windowMode, assistantHidden } = state
  return {
    mode: windowMode,
    alwaysOnTop:
      windowMode === 'mini' && mainWindow && !mainWindow.isDestroyed() ? mainWindow.isAlwaysOnTop() : false,
    visible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !assistantHidden)
  }
}

module.exports = { state, loadWindowPreferences, saveWindowPreferences, currentWindowState }
