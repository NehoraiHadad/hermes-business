const { app, ipcMain, dialog, shell } = require('electron')
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
const { performInstall } = require('./business-install.cjs')
const { findHermes, hermesHome } = require('./paths.cjs')
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
const { getPartnerFeed } = require('./partner-feed.cjs')
const { probeProviderCredential } = require('./provider-probe.cjs')
const { probeCodexGrant } = require('./codex-probe.cjs')
const { getProviderEvidence, recordProviderEvidence } = require('./provider-evidence.cjs')
const { guardStatusWithActivation, readGuardActivationJournal } = require('./whatsapp-guard-journal.cjs')
const { openFullSurface } = require('./open-full.cjs')
const { checkCompanionUpdate } = require('./companion-update.cjs')
const { registerCompanionUpdateIpc } = require('./ipc-companion-update.cjs')
const {
  normalizeOpenFileFilters,
  createSerialGuard,
  assertAllowedApiEndpoint,
  sanitizeApiInit
} = require('./ipc-guards.cjs')

// A second `hermes:install` while the first is still running would start a second
// PowerShell bootstrap against the SAME Hermes home (the first has a 45-minute
// timeout, so the overlap window is long). Serialized with the same in-flight
// idiom applyOfficialHermesUpdate uses in hermes-update.cjs; the flag is
// module-level so it survives any re-registration of the channels.
const runInstallExclusively = createSerialGuard('התקנת Hermes כבר מתבצעת')

// Single place that maps every renderer IPC channel to a module function. Keeps
// the wiring auditable and the feature modules free of Electron IPC concerns.
function registerIpc() {
  ipcMain.handle('hermes:runtime', async () => refreshRuntimeInstalled())
  ipcMain.handle('hermes:start', startHermes)
  ipcMain.handle('hermes:restart', restartHermes)
  ipcMain.handle('hermes:update', applyOfficialHermesUpdate)
  // `endpoint`/`init` are renderer-supplied and the fetch behind hermesApi
  // carries the gateway session token: only allow-listed product routes pass,
  // and init is rebuilt as {method, body} so renderer headers can never reach
  // the authenticated request (see ipc-guards.assertAllowedApiEndpoint).
  ipcMain.handle('hermes:api', (_event, endpoint, init) =>
    hermesApi(assertAllowedApiEndpoint(endpoint), sanitizeApiInit(init))
  )
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
  // Partner visibility feed: main-process aggregation of cron runs + background
  // sessions + curator insights, allow-list projected (docs/specs/partner-feed.md).
  ipcMain.handle('hermes:partner:feed', () => getPartnerFeed())
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
  ipcMain.handle('hermes:install', () =>
    runInstallExclusively(() => performInstall({ bootstrapVersion: app.getVersion() }))
  )
  // תכל'ס (companion) self-update CHECK ONLY (docs/specs/versioning.md §6.4): the
  // renderer's `force` is the sole input, normalized here to a strict boolean
  // (no other renderer-controlled input reaches the request). checkCompanionUpdate
  // owns its OWN serial guard internally (companion-update.cjs's runExclusive) and
  // never rejects — it resolves a scalar verdict for every branch, including a
  // concurrent-call rejection — so this handler must not wrap it in a second guard.
  ipcMain.handle('hermes:companion-update', (_event, force) => checkCompanionUpdate({ force: Boolean(force) }))
  // The two CONSENTED actions that can follow that check — download+verify, and
  // apply. Kept in their own module (ipc-companion-update.cjs) because unlike the
  // check they take NO renderer input at all; see that file's header for why.
  registerCompanionUpdateIpc()
  ipcMain.handle('assistant:window-state', () => currentWindowState())
  ipcMain.handle('assistant:set-window-mode', (_event, mode) => setWindowMode(mode))
  ipcMain.handle('assistant:set-always-on-top', (_event, value) => setMiniPinned(value))
  ipcMain.handle('assistant:hide', () => hideAssistant())
}

module.exports = { registerIpc }
