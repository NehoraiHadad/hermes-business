const { app, ipcMain, dialog, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const {
  refreshRuntimeInstalled,
  startHermes,
  restartHermes,
  hermesApi,
  getVersions
} = require('./runtime.cjs')
const { recentLogs } = require('./logs.cjs')
const { createDiagnosticsBundle } = require('./diagnostics.cjs')
const {
  startGoogleSetup,
  finishGoogleSetup,
  getGoogleStatus,
  ensureGatewayBackground
} = require('./google-setup.cjs')
const { installDesktopPlugin, stageBusinessBootstrap } = require('./plugin-install.cjs')
const { installWhatsappPolicyPlugin } = require('./whatsapp-plugin-install.cjs')
const { findHermes, hermesHome } = require('./paths.cjs')
const { runCaptured } = require('./process-util.cjs')
const {
  getMainWindow,
  currentWindowState,
  setWindowMode,
  setMiniPinned,
  hideAssistant
} = require('./windows.cjs')
const { registerMessagingPolicyIpc } = require('./ipc-messaging.cjs')
const { isAllowedExternalUrl } = require('./url-policy.cjs')
const { applyOfficialHermesUpdate } = require('./hermes-update.cjs')
const { getPartnerState, applyPartnerMode } = require('./business-partner.cjs')
const { getCuratorInsights } = require('./curator-insights.cjs')
const { probeProviderCredential } = require('./provider-probe.cjs')
const { probeCodexGrant } = require('./codex-probe.cjs')
const { getProviderEvidence, recordProviderEvidence } = require('./provider-evidence.cjs')
const { guardStatusWithActivation, readGuardActivationJournal } = require('./whatsapp-guard-journal.cjs')
const { openFullSurface } = require('./open-full.cjs')
const { normalizeOpenFileFilters, createSerialGuard } = require('./ipc-guards.cjs')

// A second `hermes:install` while the first is still running would start a second
// PowerShell bootstrap against the SAME Hermes home (the first has a 45-minute
// timeout, so the overlap window is long). Serialized with the same in-flight
// idiom applyOfficialHermesUpdate uses in hermes-update.cjs; the flag is
// module-level so it survives any re-registration of the channels.
const runInstallExclusively = createSerialGuard('התקנת Hermes כבר מתבצעת')

async function performInstall() {
  if (findHermes()) {
    installDesktopPlugin()
    installWhatsappPolicyPlugin()
    await ensureGatewayBackground()
    return { ok: true, installed: true }
  }
  const stagingRoot = stageBusinessBootstrap()
  try {
    await runCaptured(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', path.join(stagingRoot, 'bootstrap.ps1'),
        '-PayloadRoot', stagingRoot,
        '-BootstrapVersion', app.getVersion(),
        '-HermesHome', hermesHome(),
        '-SkipCompanionInstall',
        '-NoLaunch'
      ],
      45 * 60_000
    )
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true })
  }
  const installed = Boolean(findHermes())
  return { ok: installed, installed, code: installed ? 0 : 1 }
}

// Single place that maps every renderer IPC channel to a module function. Keeps
// the wiring auditable and the feature modules free of Electron IPC concerns.
function registerIpc() {
  ipcMain.handle('hermes:runtime', async () => refreshRuntimeInstalled())
  ipcMain.handle('hermes:start', startHermes)
  ipcMain.handle('hermes:restart', restartHermes)
  ipcMain.handle('hermes:update', applyOfficialHermesUpdate)
  ipcMain.handle('hermes:api', (_event, endpoint, init) => hermesApi(endpoint, init))
  ipcMain.handle('hermes:versions', getVersions)
  ipcMain.handle('hermes:logs', () => ({ lines: recentLogs(250) }))
  ipcMain.handle('hermes:diagnostics', createDiagnosticsBundle)
  ipcMain.handle('hermes:choose-file', async (_event, filters) => {
    // `filters` is renderer-supplied: validate the shape and forward a sanitized
    // copy, never the raw object (see ipc-guards.normalizeOpenFileFilters).
    const result = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openFile'],
      filters: normalizeOpenFileFilters(filters)
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('hermes:choose-folder', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('hermes:curator:insights', () => getCuratorInsights())
  // Provider validation: real out-of-band probe (never accepts an invalid key) + durable
  // non-secret evidence persisted in the Hermes-owned profile.
  ipcMain.handle('hermes:provider:probe', (_event, input) => probeProviderCredential(input))
  // Real, non-destructive liveness probe for an EXISTING Codex OAuth grant (the on-disk
  // logged_in snapshot is NOT proof the grant still works). Gates useExisting evidence.
  ipcMain.handle('hermes:codex:probe', () => probeCodexGrant())
  ipcMain.handle('hermes:provider:evidence:get', () => getProviderEvidence())
  ipcMain.handle('hermes:provider:evidence:set', (_event, evidence) => recordProviderEvidence(evidence))
  // Live messaging-guard introspection, liveness-verified from the dispatch-process
  // heartbeat (fails closed to null → BLOCKED in the UI).
  ipcMain.handle('hermes:whatsapp-policy:guard-status', () => guardStatusWithActivation())
  // Observable guard-activation transaction phase (restarting/verifying/active/failed) for
  // a clear UI state while an already-running gateway is being restarted after a plugin update.
  ipcMain.handle('hermes:whatsapp-policy:activation-state', () => readGuardActivationJournal())
  ipcMain.handle('hermes:partner:get', () => getPartnerState())
  ipcMain.handle('hermes:partner:apply', (_event, patch) => applyPartnerMode(patch))
  ipcMain.handle('hermes:google:start', (_event, clientSecretPath, services) =>
    startGoogleSetup(clientSecretPath, services)
  )
  ipcMain.handle('hermes:google:finish', (_event, code) => finishGoogleSetup(code))
  ipcMain.handle('hermes:google:status', getGoogleStatus)
  ipcMain.handle('hermes:gateway:ensure', () => ensureGatewayBackground())
  registerMessagingPolicyIpc(ipcMain)
  ipcMain.handle('hermes:open-external', (_event, url) => {
    if (!isAllowedExternalUrl(url)) throw new Error('External URL is not allowed')
    return shell.openExternal(url)
  })
  ipcMain.handle('hermes:open-full', async (_event, surface) => {
    return openFullSurface(surface, { command: findHermes(), home: hermesHome(), shell })
  })
  ipcMain.handle('hermes:install', () => runInstallExclusively(performInstall))
  ipcMain.handle('assistant:window-state', () => currentWindowState())
  ipcMain.handle('assistant:set-window-mode', (_event, mode) => setWindowMode(mode))
  ipcMain.handle('assistant:set-always-on-top', (_event, value) => setMiniPinned(value))
  ipcMain.handle('assistant:hide', () => hideAssistant())
}

module.exports = { registerIpc }
