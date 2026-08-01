const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { getQaRuntimeOverride } = require('./qa-runtime.cjs')

// Filesystem discovery for the Hermes install and the bundled plugin payloads.
// Pure lookups with no runtime state, so every other module can depend on it.

function hermesHome() {
  // Automated-QA isolation: when the main-process-only override is active, every
  // home-derived read/write in this process targets the throwaway temp home, so
  // the packaged E2E never mutates the live profile. getQaRuntimeOverride throws
  // (fail-closed) if a QA run was requested with an invalid home. The binary
  // lookup in findHermes() is intentionally NOT redirected here — it still finds
  // the real installed Hermes because the QA contract uses its own env vars, not
  // HERMES_HOME.
  const qa = getQaRuntimeOverride()
  if (qa.enabled) return qa.hermesHome
  if (process.env.HERMES_HOME) return process.env.HERMES_HOME
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'hermes')
  }
  return path.join(os.homedir(), '.hermes')
}

function findHermes() {
  const explicitHome = Boolean(process.env.HERMES_HOME)
  if (explicitHome) {
    const explicitCandidates = process.platform === 'win32'
      ? [
          path.join(hermesHome(), 'hermes-agent', 'venv', 'Scripts', 'hermes.exe'),
          path.join(hermesHome(), 'bin', 'hermes.exe')
        ]
      : [path.join(hermesHome(), 'hermes-agent', 'venv', 'bin', 'hermes')]
    return explicitCandidates.find(candidate => fs.existsSync(candidate)) || null
  }

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

function companionBootstrapSource() {
  return path.join(__dirname, '..', 'installer', 'bootstrap-companion.ps1')
}

// The fail-closed WhatsApp reply-policy plugin ships as a real Hermes user
// plugin (Python). It is copied into <hermesHome>/plugins/<id> and activated
// through the official `hermes plugins enable` command. Only these files make
// up the runtime payload — the co-located pytest module is not shipped.
const WHATSAPP_POLICY_PLUGIN_ID = 'business-whatsapp-policy'
const WHATSAPP_POLICY_PLUGIN_FILES = Object.freeze([
  '__init__.py',
  'policy.py',
  'ingest.py',
  'contract.py',
  'surface.py',
  'guards.py',
  'transport.py',
  'registry.py',
  'plugin.yaml'
])

function whatsappPolicyPluginSource() {
  return path.join(__dirname, '..', 'hermes-plugin', WHATSAPP_POLICY_PLUGIN_ID)
}

module.exports = {
  hermesHome,
  findHermes,
  getHermesVersion,
  desktopPluginSource,
  bootstrapSkillSource,
  companionBootstrapSource,
  whatsappPolicyPluginSource,
  WHATSAPP_POLICY_PLUGIN_ID,
  WHATSAPP_POLICY_PLUGIN_FILES
}
