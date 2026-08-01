const { app, dialog } = require('electron')
const os = require('node:os')
const path = require('node:path')
const AdmZip = require('adm-zip')
const { getVersions, hermesApi, getRuntimeState } = require('./runtime.cjs')
const { getMainWindow } = require('./windows.cjs')
const { redactSecrets } = require('./redact.cjs')
const { serializeDiagnostics, buildManifest } = require('./diagnostics-core.cjs')

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

  const manifest = buildManifest({
    versions,
    health,
    status,
    runtimeState: getRuntimeState(),
    createdAt: new Date().toISOString(),
    platform: { type: os.type(), release: os.release(), arch: os.arch() }
  })
  const zip = new AdmZip()
  zip.addFile('diagnostics.json', Buffer.from(serializeDiagnostics(manifest)))
  zip.addFile(
    'README.txt',
    Buffer.from(
      redactSecrets(
        [
          'Hermes Business diagnostic bundle',
          '',
          'This bundle intentionally contains only an allow-listed runtime summary.',
          'Raw logs are excluded because they may contain conversation or business content.',
          'No API keys, tokens, emails, chat content, business files, customer data, or secrets are included.',
          'Any secret, token, or personal file path that survived the allow-list is stripped to <redacted>,',
          'and any surviving email address is stripped to <redacted>@domain.'
        ].join('\n')
      )
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

module.exports = { createDiagnosticsBundle, serializeDiagnostics, buildManifest }
