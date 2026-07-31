const { redact } = require('./security.cjs')

// In-memory ring buffer of redacted runtime log lines. Also mirrors each line to
// the renderer (for the live log view) when a window is available. The window
// lookup is required lazily to avoid a load-time cycle with windows.cjs.
const runtimeLogs = []

function rememberLog(raw) {
  const line = redact(String(raw || '').trim())
  if (!line) return
  runtimeLogs.push(`${new Date().toISOString()} ${line}`)
  if (runtimeLogs.length > 600) runtimeLogs.shift()
  const mainWindow = require('./windows.cjs').getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('hermes:runtime-log', line)
  }
}

function recentLogs(count = 250) {
  return runtimeLogs.slice(-count)
}

module.exports = { rememberLog, recentLogs }
