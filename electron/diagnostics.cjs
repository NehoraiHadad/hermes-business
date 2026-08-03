const { app, dialog } = require('electron')
const os = require('node:os')
const path = require('node:path')
const AdmZip = require('adm-zip')
const { getVersions, hermesApi, getRuntimeState } = require('./runtime.cjs')
const { getMainWindow } = require('./windows.cjs')
const { redactSecrets } = require('./redact.cjs')
const { serializeDiagnostics, buildManifest } = require('./diagnostics-core.cjs')
const { recentAppErrors } = require('./error-journal.cjs')

// Best-effort gather of one optional diagnostics fact: a failed read yields
// null ("no proof"), never a fabricated value and never a failed bundle.
async function tryGather(read) {
  try {
    return await read()
  } catch {
    return null
  }
}

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

  // Optional analyzability facts (enums/booleans/counters only). Each is
  // independently best-effort so a broken subsystem still yields a bundle that
  // describes the rest — which is exactly when a bundle is needed most.
  const guard = await tryGather(async () => {
    const { guardStatusWithActivation, readGuardActivationJournal } = require('./whatsapp-guard-journal.cjs')
    const live = await guardStatusWithActivation()
    const journal = readGuardActivationJournal()
    if (!live && !journal) return null
    return { ...(live || {}), activationPhase: journal?.phase ?? null }
  })
  const updateJournal = await tryGather(() => require('./update-journal-store.cjs').readJournal())
  const partner = await tryGather(() => require('./partner-settings.cjs').readSettings())

  const manifest = buildManifest({
    versions,
    health,
    status,
    runtimeState: getRuntimeState(),
    createdAt: new Date().toISOString(),
    platform: { type: os.type(), release: os.release(), arch: os.arch() },
    guard,
    updateJournal,
    partner,
    recentErrors: recentAppErrors(),
    uptimeSeconds: process.uptime()
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
          'This bundle intentionally contains only an allow-listed runtime summary,',
          'plus a redacted app-level error timeline (app-generated messages only).',
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
