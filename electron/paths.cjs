const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { getRuntimeMode, resolveHermesBinary } = require('./runtime-mode.cjs')

// Filesystem discovery for the Hermes install and the bundled plugin payloads.
// Pure lookups with no runtime state, so every other module can depend on it.

function hermesHome() {
  // Product-owned runtime selection. A generic ambient HERMES_HOME is
  // intentionally NOT authoritative here: an installer/E2E process can leave
  // one in Explorer's environment and silently redirect a production launch.
  return getRuntimeMode().hermesHome
}

function findHermes() {
  // Never select a runtime from PATH. Binary provenance and data-home routing
  // are separate contracts, so stale E2E PATH entries cannot win production.
  return resolveHermesBinary(getRuntimeMode())
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

// The companion backend plugin that Hermes mounts at /api/plugins/business-shell/
// — a strictly read-only paused-inclusive cron door, reached by the desktop plugin
// through its namespace-locked ctx.rest. plugin_api.py is the mounted entrypoint
// (manifest `api`) and is fully self-contained (no sibling runtime modules): the
// business-context skill is persisted through the official Hermes Skills API, so no
// custom write engine ships here. The co-located test_*.py are NOT shipped. Keep this
// list in lockstep with the installer/probe/build enumerations (BackendEnable.ps1,
// install-plugin.mjs, plugin-install.mjs, business-bootstrap.nsi, package.json
// extraResources).
const DESKTOP_BACKEND_FILES = Object.freeze([
  'manifest.json',
  'plugin_api.py'
])

function desktopBackendSourceDir() {
  return path.join(__dirname, '..', 'hermes-plugin', 'business-shell', 'dashboard')
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
  'guard_core.py',
  'surface_core.py',
  'dispatch.py',
  'families.py',
  'egress.py',
  'tool_hook.py',
  'tool_transport.py',
  'tool_contract.py',
  'guard_status.py',
  'plugin.yaml'
])
const WHATSAPP_POLICY_PLUGIN_OBSOLETE_FILES = Object.freeze([
  'telegram_policy.py',
  'telegram_contract.py',
  'telegram_surface.py',
  'telegram_transport.py',
  'telegram_registry.py'
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
  desktopBackendSourceDir,
  DESKTOP_BACKEND_FILES,
  companionBootstrapSource,
  whatsappPolicyPluginSource,
  WHATSAPP_POLICY_PLUGIN_ID,
  WHATSAPP_POLICY_PLUGIN_FILES,
  WHATSAPP_POLICY_PLUGIN_OBSOLETE_FILES
}
