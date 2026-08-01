const fs = require('node:fs')
const path = require('node:path')
const { hermesHome, whatsappPolicyPluginSource, WHATSAPP_POLICY_PLUGIN_ID } = require('./paths.cjs')

// Desktop reader for the LIVE messaging-guard heartbeat that the policy plugin writes FROM
// the gateway dispatch process (hermes-plugin/business-whatsapp-policy/guard_status.py).
//
// The gateway (hermes gateway run) — NOT the serve/web process — is where the messaging
// hooks + send_message transport monkeypatch actually enforce. The only plugin HTTP mount
// point lives in the serve process, so it cannot prove gateway enforcement; and a static
// install receipt proves nothing about a live process. So we require a heartbeat that was
// produced FROM the gateway process and is still LIVE:
//
//   * role === 'gateway'          (produced by the dispatch process, not serve)
//   * enforcing === true          (transport bound AND pre_gateway_dispatch registered there)
//   * transport_bound === true    (the send_message chokepoints carry our guard flag)
//   * hooks include pre_gateway_dispatch
//   * plugin_version === the INSTALLED plugin version  (not a stale/older build)
//   * pid is ALIVE                (the gateway process is running)
//   * updated_at within its TTL   (the refresh thread is still ticking → not a dead process)
//
// Any miss → return null → the app renders BLOCKED/unknown (never falsely protected).

const REQUIRED_HOOK = 'pre_gateway_dispatch'
const DEFAULT_TTL_SECONDS = 90

function heartbeatPath(role = 'gateway') {
  return path.join(hermesHome(), 'business-state', `whatsapp-guard-heartbeat-${role}.json`)
}

function _readVersionFromYaml(yamlPath) {
  try {
    const text = fs.readFileSync(yamlPath, 'utf8')
    const line = text.split(/\r?\n/).find(l => l.trim().startsWith('version:'))
    if (!line) return null
    return line.split(':', 2)[1].trim().replace(/^['"]|['"]$/g, '') || null
  } catch {
    return null
  }
}

// The version of the plugin ACTUALLY installed in this profile. A heartbeat whose version
// differs is stale (an older gateway that has not reloaded the updated plugin) → BLOCKED.
function installedPluginVersion() {
  const installed = _readVersionFromYaml(
    path.join(hermesHome(), 'plugins', WHATSAPP_POLICY_PLUGIN_ID, 'plugin.yaml')
  )
  if (installed) return installed
  // Fall back to the bundled source version (dev/unpackaged) so a match is still possible.
  return _readVersionFromYaml(path.join(whatsappPolicyPluginSource(), 'plugin.yaml'))
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM = the process exists but we may not signal it → still alive.
    return err && err.code === 'EPERM'
  }
}

// Pure verifier. Returns the RAW guard object (for src/lib/whatsapp-policy.ts::
// interpretWhatsappGuard) ONLY when the heartbeat positively proves live gateway
// enforcement; otherwise null. All liveness inputs are injected for testability.
function verifyGuardHeartbeat(heartbeat, deps = {}) {
  if (!heartbeat || typeof heartbeat !== 'object') return null
  const now = typeof deps.now === 'number' ? deps.now : Date.now()
  const pidAlive = deps.isPidAlive || isPidAlive
  const expectedVersion = deps.installedVersion
  // The nonce of the gateway process that was running BEFORE a plugin-update restart.
  // A heartbeat still carrying it was produced by that SAME (pre-restart) process, so it
  // proves nothing about the reloaded code — fail closed until the NEW process publishes a
  // fresh-nonce heartbeat. This closes the gap where a plugin's code changes without its
  // version string bumping (version match alone would falsely accept the stale gateway).
  const supersedeNonce = deps.supersedeNonce

  if (heartbeat.process_role !== 'gateway') return null
  if (heartbeat.enforcing !== true) return null
  if (heartbeat.transport_bound !== true) return null
  const hooks = Array.isArray(heartbeat.hooks) ? heartbeat.hooks.map(String) : []
  if (!hooks.includes(REQUIRED_HOOK)) return null
  // Stale version (gateway running an older plugin build that hasn't reloaded) → BLOCKED.
  if (!heartbeat.plugin_version || (expectedVersion && heartbeat.plugin_version !== expectedVersion)) return null
  // Superseded by a restart: this is the pre-restart process's heartbeat → BLOCKED.
  if (supersedeNonce && heartbeat.nonce && heartbeat.nonce === supersedeNonce) return null
  // Liveness: the producing gateway process must still be running.
  if (!pidAlive(Number(heartbeat.pid))) return null
  // Freshness: the refresh thread must have written recently (a dead process goes stale,
  // which also defends against pid reuse).
  const ttlMs = 1000 * (Number(heartbeat.ttl_seconds) || DEFAULT_TTL_SECONDS)
  const updated = Date.parse(heartbeat.updated_at)
  if (!Number.isFinite(updated)) return null
  if (updated > now + 60_000) return null // implausible future timestamp
  if (now - updated > ttlMs) return null

  // Positively proven live — return the raw shape the app's fail-closed parser consumes,
  // plus the rich verification fields for diagnostics.
  return {
    plugin_loaded: true,
    enforcing: true,
    hooks,
    mode: typeof heartbeat.mode === 'string' ? heartbeat.mode : null,
    reply_chats: Number(heartbeat.reply_chats) || 0,
    pid: Number(heartbeat.pid),
    nonce: heartbeat.nonce,
    plugin_version: heartbeat.plugin_version,
    guard_families: Array.isArray(heartbeat.guard_families) ? heartbeat.guard_families : [],
    process_role: 'gateway',
    updated_at: heartbeat.updated_at
  }
}

// Raw parse of the role heartbeat file (no verification). Used to capture the CURRENT
// gateway process identity (nonce/pid) BEFORE a plugin-update restart so the activation
// transaction can require the next process to publish a different nonce. Null on any error.
function readGuardHeartbeat(role = 'gateway') {
  try {
    return JSON.parse(fs.readFileSync(heartbeatPath(role), 'utf8'))
  } catch {
    return null
  }
}

// Read + liveness-verify the gateway heartbeat. Returns the verified raw guard object or
// null. Fails closed on any read/parse error. `deps` forwards optional supersedeNonce /
// injected liveness so the activation reader can bind to a specific post-restart process.
function getWhatsappGuardStatus(deps = {}) {
  const heartbeat = readGuardHeartbeat('gateway')
  if (!heartbeat) return null
  return verifyGuardHeartbeat(heartbeat, { installedVersion: installedPluginVersion(), ...deps })
}

module.exports = {
  heartbeatPath,
  installedPluginVersion,
  isPidAlive,
  verifyGuardHeartbeat,
  readGuardHeartbeat,
  getWhatsappGuardStatus,
  REQUIRED_HOOK
}
