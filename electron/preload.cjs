const { contextBridge, ipcRenderer } = require('electron')

// This preload runs SANDBOXED (see window-create.cjs: `sandbox: true`). In a
// sandboxed preload Electron replaces `require` with a polyfill that resolves
// ONLY its own loadable modules (`electron`, `events`, `timers`, `url`) and
// throws `module not found` for anything else — so every helper below must stay
// inline in this file. electron/preload.test.ts loads this exact file through the
// same single-module require contract, which both exercises the helpers and
// fails loudly if a relative require is ever added here.

// Electron wraps ANY error a `ipcMain.handle` handler throws before the renderer
// sees it. Verified against the shipped Electron 43 runtime: the main process
// replies with `error.toString()` and the renderer throws
//   new Error(`Error invoking remote method '<channel>': <that string>`)
// so a handler that threw `new Error('העדכון נכשל')` reaches the UI as
//   "Error invoking remote method 'hermes:update': Error: העדכון נכשל".
// The main process is where the user-facing Hebrew messages are authored
// (hermes-update-flow.cjs, hermes-compat.cjs, …) and several renderer consumers
// render `err.message` verbatim (e.g. src/hooks/useSupportActions.ts). Stripping
// the wrapper HERE — the single boundary every consumer shares — fixes them all
// without touching the renderer or changing the bridge surface.
//
// The optional inner class prefix covers both `Error: ` and `TypeError: `-style
// `toString()` output, and stays optional for a handler that threw a non-Error.
const REMOTE_INVOKE_PREFIX = /^Error invoking remote method '[^']*': (?:(?:[A-Za-z_$][A-Za-z0-9_$]*)?Error: )?/

function stripRemoteInvokePrefix(message) {
  const text = typeof message === 'string' ? message : String(message == null ? '' : message)
  const stripped = text.replace(REMOTE_INVOKE_PREFIX, '')
  // Never turn a message into an empty string: an unhelpful English wrapper is
  // still better than no message at all.
  return stripped.trim() ? stripped : text
}

// Every bridged call goes through here, so no channel can be added later with the
// mangled-error behaviour. Signatures/return values are unchanged; only the
// rejection message is normalized.
async function invoke(channel, ...args) {
  try {
    return await ipcRenderer.invoke(channel, ...args)
  } catch (caught) {
    const raw = caught instanceof Error ? caught.message : String(caught)
    const clean = stripRemoteInvokePrefix(raw)
    if (clean === raw) throw caught
    throw new Error(clean)
  }
}

contextBridge.exposeInMainWorld('hermesDesktop', {
  getRuntime: () => invoke('hermes:runtime'),
  startRuntime: () => invoke('hermes:start'),
  restartRuntime: () => invoke('hermes:restart'),
  applyUpdate: () => invoke('hermes:update'),
  installHermes: () => invoke('hermes:install'),
  api: (path, init) => invoke('hermes:api', path, init),
  openFull: surface => invoke('hermes:open-full', surface),
  openExternal: url => invoke('hermes:open-external', url),
  chooseFile: filters => invoke('hermes:choose-file', filters),
  chooseFolder: () => invoke('hermes:choose-folder'),
  getCuratorInsights: () => invoke('hermes:curator:insights'),
  getPartnerFeed: () => invoke('hermes:partner:feed'),
  getPartnerState: () => invoke('hermes:partner:get'),
  applyPartnerMode: patch => invoke('hermes:partner:apply', patch),
  startGoogleSetup: clientSecretPath => invoke('hermes:google:start', clientSecretPath),
  finishGoogleSetup: code => invoke('hermes:google:finish', code),
  getGoogleStatus: () => invoke('hermes:google:status'),
  ensureGateway: () => invoke('hermes:gateway:ensure'),
  getWhatsappPolicy: () => invoke('hermes:whatsapp-policy:get'),
  getWhatsappDirectory: () => invoke('hermes:whatsapp-directory:get'),
  setWhatsappPolicy: policy => invoke('hermes:whatsapp-policy:set', policy),
  ensureWhatsappPolicy: () => invoke('hermes:whatsapp-policy:ensure'),
  getWhatsappGuard: () => invoke('hermes:whatsapp-policy:guard-status'),
  // Observable guard-activation transaction phase (restarting/verifying/active/failed) so the
  // UI can surface an in-progress gateway restart instead of a bare BLOCKED state.
  getWhatsappGuardActivation: () => invoke('hermes:whatsapp-policy:activation-state'),
  probeProvider: input => invoke('hermes:provider:probe', input),
  probeCodexGrant: () => invoke('hermes:codex:probe'),
  getProviderEvidence: () => invoke('hermes:provider:evidence:get'),
  recordProviderEvidence: evidence => invoke('hermes:provider:evidence:set', evidence),
  createDiagnostics: () => invoke('hermes:diagnostics'),
  getRecentLogs: () => invoke('hermes:logs'),
  getVersions: () => invoke('hermes:versions'),
  getWindowState: () => invoke('assistant:window-state'),
  setWindowMode: mode => invoke('assistant:set-window-mode', mode),
  setAlwaysOnTop: value => invoke('assistant:set-always-on-top', value),
  hideWindow: () => invoke('assistant:hide'),
  onRuntimeLog: callback => {
    const listener = (_event, line) => callback(line)
    ipcRenderer.on('hermes:runtime-log', listener)
    return () => ipcRenderer.removeListener('hermes:runtime-log', listener)
  },
  // תכל'ס (companion) self-update CHECK (docs/specs/versioning.md §6.4): the ONLY
  // renderer input is `force`; the request, fetch and verdict decision all live
  // in main (companion-update.cjs) — this call never resolves anything but the
  // scalar verdict shape.
  checkCompanionUpdate: force => invoke('hermes:companion-update', force),
  // Passive push (§6.5): a ONE-SHOT event from the main-process startup timer,
  // fired only when it found an update-available verdict. Same
  // subscribe/unsubscribe idiom as onRuntimeLog above.
  onCompanionUpdateAvailable: callback => {
    const listener = (_event, status) => callback(status)
    ipcRenderer.on('hermes:companion-update-available', listener)
    return () => ipcRenderer.removeListener('hermes:companion-update-available', listener)
  },
  // The two CONSENTED update actions (§7). Note the deliberate absence of any
  // argument: unlike checkCompanionUpdate's `force`, these pass NOTHING. Main
  // derives every operand — release, asset URLs, installer path — from artifacts
  // it produced itself (the verdict and the durable journal), so a compromised
  // renderer cannot redirect a download or name a file to execute. See
  // electron/ipc-companion-update.cjs.
  downloadCompanionUpdate: () => invoke('hermes:companion-download'),
  cancelCompanionDownload: () => invoke('hermes:companion-download-cancel'),
  // Resolves only if the apply is REFUSED; on success the app is quitting and
  // this promise never settles.
  applyCompanionUpdate: () => invoke('hermes:companion-apply'),
  companionUpdateState: () => invoke('hermes:companion-update-state'),
  onCompanionDownloadProgress: callback => {
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('hermes:companion-download-progress', listener)
    return () => ipcRenderer.removeListener('hermes:companion-download-progress', listener)
  }
})
