const { app, dialog } = require('electron')
const os = require('node:os')
const path = require('node:path')
const AdmZip = require('adm-zip')
const { getVersions, hermesApi, getRuntimeState } = require('./runtime.cjs')
const { getMainWindow } = require('./windows.cjs')

// Builds a strictly allow-listed diagnostics ZIP: a runtime/health summary and a
// README only. No API keys, tokens, conversation/email content, business files,
// or customer data are ever included — the E2E asserts this.
async function createDiagnosticsBundle() {
  const versions = await getVersions()
  let health = null
  let status = null
  try {
    health = await hermesApi('/api/health')
    status = await hermesApi('/api/status')
  } catch (error) {
    health = { ok: false, error: String(error.message || error) }
  }

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

  const runtimeState = getRuntimeState()
  const manifest = {
    created_at: new Date().toISOString(),
    privacy:
      'No API keys, tokens, conversation content, email content, business files, or customer data are included.',
    platform: { type: os.type(), release: os.release(), arch: os.arch() },
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
  const zip = new AdmZip()
  zip.addFile('diagnostics.json', Buffer.from(JSON.stringify(manifest, null, 2)))
  zip.addFile(
    'README.txt',
    Buffer.from(
      [
        'Hermes Business diagnostic bundle',
        '',
        'This bundle intentionally contains only an allow-listed runtime summary.',
        'Raw logs are excluded because they may contain conversation or business content.',
        'No API keys, tokens, email content, chat content, business files, customer data, or secrets are included.'
      ].join('\n')
    )
  )
  const defaultName = `hermes-diagnostics-${new Date().toISOString().slice(0, 10)}.zip`
  const result = await dialog.showSaveDialog(getMainWindow(), {
    title: 'שמירת חבילת אבחון',
    defaultPath: path.join(app.getPath('downloads'), defaultName),
    filters: [{ name: 'ZIP', extensions: ['zip'] }]
  })
  if (result.canceled || !result.filePath) return { ok: false, canceled: true }
  zip.writeZip(result.filePath)
  return { ok: true, path: result.filePath }
}

module.exports = { createDiagnosticsBundle }
