const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Filesystem discovery for the Hermes install and the bundled plugin payloads.
// Pure lookups with no runtime state, so every other module can depend on it.

function hermesHome() {
  if (process.env.HERMES_HOME) return process.env.HERMES_HOME
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'hermes')
  }
  return path.join(os.homedir(), '.hermes')
}

function findHermes() {
  const probe = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['hermes'], {
    encoding: 'utf8',
    windowsHide: true
  })
  if (probe.status === 0) {
    const first = probe.stdout.split(/\r?\n/).find(Boolean)
    if (first) return first.trim()
  }

  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.LOCALAPPDATA || '', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'hermes', 'bin', 'hermes.exe'),
        path.join(os.homedir(), '.local', 'bin', 'hermes.exe'),
        path.join(os.homedir(), '.local', 'bin', 'hermes.cmd')
      ]
    : [path.join(os.homedir(), '.local', 'bin', 'hermes')]

  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || null
}

function getHermesVersion(command) {
  if (!command) return null
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true })
  const output = `${result.stdout || ''} ${result.stderr || ''}`.trim()
  return output || null
}

function desktopPluginSource() {
  return path.join(__dirname, '..', 'hermes-plugin', 'business-shell', 'plugin.js')
}

function bootstrapSkillSource() {
  return path.join(__dirname, '..', 'hermes-plugin', 'business-shell', 'skills', 'business-bootstrap', 'SKILL.md')
}

module.exports = { hermesHome, findHermes, getHermesVersion, desktopPluginSource, bootstrapSkillSource }
