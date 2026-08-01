// Pure, electron-free core of the diagnostics bundle: the strict allow-list
// projection and the serialize+redact chokepoint. Kept in its own module (no
// `require('electron')`) so the end-to-end payload test can feed poisoned raw
// inputs and prove nothing forbidden survives, without launching Electron.

const { redactSecrets } = require('./redact.cjs')

// Serialize the diagnostics manifest to pretty JSON and run the defense-in-depth
// redaction pass so that any secret-, path- or email-shaped string that survived
// the allow-list is stripped before it is written to disk.
function serializeDiagnostics(manifest) {
  return redactSecrets(JSON.stringify(manifest, null, 2))
}

// Allow-list projection: from raw (possibly poisoned) versions/health/status and
// runtime state, keep only typed scalars for a fixed set of keys. Every field is
// coerced to its expected primitive, so unexpected keys, nested objects, and any
// chat/message/business content or secret carried on an unknown field is
// structurally dropped — it can never appear in the manifest. `createdAt` and
// `platform` are injected so callers/tests control them deterministically.
function buildManifest({ versions, health, status, runtimeState, createdAt, platform }) {
  const safeHealth = health
    ? {
        ok: Boolean(health.ok),
        version: typeof health.version === 'string' ? health.version : null,
        auth_required: Boolean(health.auth_required)
      }
    : null
  const safeComponents = Object.fromEntries(
    Object.entries(status?.components || {}).map(([name, component]) => [
      name,
      {
        status: typeof component?.status === 'string' ? component.status : null,
        state: typeof component?.state === 'string' ? component.state : null,
        configured: Number.isFinite(component?.configured) ? component.configured : null,
        connected: Number.isFinite(component?.connected) ? component.connected : null
      }
    ])
  )
  const safeStatus = status
    ? {
        version: typeof status.version === 'string' ? status.version : null,
        release_date: typeof status.release_date === 'string' ? status.release_date : null,
        config_version: status.config_version ?? null,
        latest_config_version: status.latest_config_version ?? null,
        can_update_hermes: Boolean(status.can_update_hermes),
        gateway_running: Boolean(status.gateway_running),
        gateway_state: typeof status.gateway_state === 'string' ? status.gateway_state : null,
        gateway_busy: Boolean(status.gateway_busy),
        gateway_drainable: Boolean(status.gateway_drainable),
        active_agents: Number.isFinite(status.active_agents) ? status.active_agents : null,
        active_sessions: Number.isFinite(status.active_sessions) ? status.active_sessions : null,
        auth_required: Boolean(status.auth_required),
        nous_session_valid: typeof status.nous_session_valid === 'string' ? status.nous_session_valid : null,
        overall: typeof status.overall === 'string' ? status.overall : null,
        components: safeComponents
      }
    : null

  return {
    created_at: createdAt,
    privacy:
      'No API keys, tokens, conversation content, email content, business files, ' +
      'customer data, secrets, or personal file paths are included. Any such value ' +
      'that survived the allow-list is stripped to <redacted>.',
    platform,
    versions,
    runtime: {
      installed: runtimeState.installed,
      running: runtimeState.running,
      starting: runtimeState.starting,
      mode: runtimeState.mode,
      error_present: Boolean(runtimeState.error)
    },
    health: safeHealth,
    status: safeStatus
  }
}

module.exports = { serializeDiagnostics, buildManifest }
