const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

function launchDetached(command, args, spawnProcess = spawn) {
  const child = spawnProcess(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.unref()
}

// Open a real Hermes user surface. The companion's managed `hermes serve`
// process is API-only, so its loopback URL must never be opened as a web UI.
async function openFullSurface(surface, { command, home, shell, spawnProcess = spawn }) {
  if (surface === 'logs') {
    const logPath = path.join(home, 'logs')
    fs.mkdirSync(logPath, { recursive: true })
    await shell.openPath(logPath)
    return { ok: true }
  }

  if (!command) throw new Error('Hermes is not installed')
  if (surface === 'desktop') {
    launchDetached(command, ['desktop'], spawnProcess)
    return { ok: true }
  }
  if (surface === 'dashboard' || surface === 'settings') {
    // Port 9119 belongs to the companion's headless API runtime. Let the real
    // dashboard choose a free port, then open its own authenticated browser UI.
    launchDetached(command, ['dashboard', '--port', '0'], spawnProcess)
    return { ok: true }
  }
  throw new Error(`Unknown Hermes surface: ${surface}`)
}

module.exports = { openFullSurface, launchDetached }
