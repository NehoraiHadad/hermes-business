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
const MAX_ERROR_TEXT = 500
const MAX_RECENT_ERRORS = 50

// Coerce one app-error journal entry to typed scalars (the journal already
// redacts at ingestion; the serialize chokepoint re-redacts anyway).
function safeErrorEntry(entry) {
  return {
    at: typeof entry?.at === 'string' ? entry.at : null,
    source: typeof entry?.source === 'string' ? entry.source.slice(0, 40) : null,
    message: typeof entry?.message === 'string' ? entry.message.slice(0, 300) : null
  }
}

function buildManifest({
  versions,
  health,
  status,
  runtimeState,
  createdAt,
  platform,
  guard,
  updateJournal,
  partner,
  recentErrors,
  uptimeSeconds
}) {
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

  // Live messaging-guard proof, projected to enums/booleans. null means "no
  // proof was obtainable" — never fabricated, mirroring the UI's fail-closed
  // reading of the same source.
  const safeGuard = guard
    ? {
        plugin_loaded: Boolean(guard.pluginLoaded ?? guard.plugin_loaded),
        enforcing: Boolean(guard.enforcing),
        mode: typeof guard.mode === 'string' ? guard.mode : null,
        activation_phase: typeof guard.activationPhase === 'string' ? guard.activationPhase : null
      }
    : null

  // An incomplete-update journal is one of the most valuable single facts for
  // support: phase + failure count, never paths or command output.
  const safeUpdateJournal = updateJournal
    ? {
        present: true,
        phase: typeof updateJournal.phase === 'string' ? updateJournal.phase : null,
        failures: Array.isArray(updateJournal.failures) ? updateJournal.failures.length : 0
      }
    : { present: false, phase: null, failures: 0 }

  const safePartner = partner
    ? {
        mode: typeof partner.mode === 'string' ? partner.mode : null,
        sandbox: typeof partner.sandbox === 'string' ? partner.sandbox : null
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
    uptime_seconds: Number.isFinite(uptimeSeconds) ? Math.round(uptimeSeconds) : null,
    runtime: {
      installed: runtimeState.installed,
      running: runtimeState.running,
      starting: runtimeState.starting,
      mode: runtimeState.mode,
      isolated: Boolean(runtimeState.isolated),
      version: typeof runtimeState.version === 'string' ? runtimeState.version : null,
      compatible: Boolean(runtimeState.compatible),
      compat_range: typeof runtimeState.compatRange === 'string' ? runtimeState.compatRange : null,
      error_present: Boolean(runtimeState.error),
      // The single most-requested support fact: the actual failure text. App-
      // generated vocabulary, redacted here AND by the serialize chokepoint.
      error: runtimeState.error ? String(runtimeState.error).slice(0, MAX_ERROR_TEXT) : null
    },
    whatsapp_guard: safeGuard,
    update_journal: safeUpdateJournal,
    partner: safePartner,
    // App-level error journal (redacted at ingestion): timeline of what failed
    // and in which domain — never raw gateway/runtime logs.
    recent_errors: Array.isArray(recentErrors)
      ? recentErrors.slice(-MAX_RECENT_ERRORS).map(safeErrorEntry)
      : [],
    health: safeHealth,
    status: safeStatus
  }
}

module.exports = { serializeDiagnostics, buildManifest }
