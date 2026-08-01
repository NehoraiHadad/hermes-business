const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hermesDesktop', {
  getRuntime: () => ipcRenderer.invoke('hermes:runtime'),
  startRuntime: () => ipcRenderer.invoke('hermes:start'),
  restartRuntime: () => ipcRenderer.invoke('hermes:restart'),
  applyUpdate: () => ipcRenderer.invoke('hermes:update'),
  installHermes: () => ipcRenderer.invoke('hermes:install'),
  api: (path, init) => ipcRenderer.invoke('hermes:api', path, init),
  openFull: surface => ipcRenderer.invoke('hermes:open-full', surface),
  openExternal: url => ipcRenderer.invoke('hermes:open-external', url),
  chooseFile: filters => ipcRenderer.invoke('hermes:choose-file', filters),
  chooseFolder: () => ipcRenderer.invoke('hermes:choose-folder'),
  getCuratorInsights: () => ipcRenderer.invoke('hermes:curator:insights'),
  getPartnerState: () => ipcRenderer.invoke('hermes:partner:get'),
  applyPartnerMode: patch => ipcRenderer.invoke('hermes:partner:apply', patch),
  startGoogleSetup: (clientSecretPath, services) =>
    ipcRenderer.invoke('hermes:google:start', clientSecretPath, services),
  finishGoogleSetup: code => ipcRenderer.invoke('hermes:google:finish', code),
  getGoogleStatus: () => ipcRenderer.invoke('hermes:google:status'),
  ensureGateway: () => ipcRenderer.invoke('hermes:gateway:ensure'),
  getWhatsappPolicy: () => ipcRenderer.invoke('hermes:whatsapp-policy:get'),
  setWhatsappPolicy: policy => ipcRenderer.invoke('hermes:whatsapp-policy:set', policy),
  ensureWhatsappPolicy: () => ipcRenderer.invoke('hermes:whatsapp-policy:ensure'),
  getWhatsappGuard: () => ipcRenderer.invoke('hermes:whatsapp-policy:guard-status'),
  // Observable guard-activation transaction phase (restarting/verifying/active/failed) so the
  // UI can surface an in-progress gateway restart instead of a bare BLOCKED state.
  getWhatsappGuardActivation: () => ipcRenderer.invoke('hermes:whatsapp-policy:activation-state'),
  probeProvider: input => ipcRenderer.invoke('hermes:provider:probe', input),
  probeCodexGrant: () => ipcRenderer.invoke('hermes:codex:probe'),
  getProviderEvidence: () => ipcRenderer.invoke('hermes:provider:evidence:get'),
  recordProviderEvidence: evidence => ipcRenderer.invoke('hermes:provider:evidence:set', evidence),
  getTelegramPolicy: () => ipcRenderer.invoke('hermes:telegram-policy:get'),
  setTelegramPolicy: policy => ipcRenderer.invoke('hermes:telegram-policy:set', policy),
  ensureTelegramPolicy: () => ipcRenderer.invoke('hermes:telegram-policy:ensure'),
  createDiagnostics: () => ipcRenderer.invoke('hermes:diagnostics'),
  getRecentLogs: () => ipcRenderer.invoke('hermes:logs'),
  getVersions: () => ipcRenderer.invoke('hermes:versions'),
  getWindowState: () => ipcRenderer.invoke('assistant:window-state'),
  setWindowMode: mode => ipcRenderer.invoke('assistant:set-window-mode', mode),
  setAlwaysOnTop: value => ipcRenderer.invoke('assistant:set-always-on-top', value),
  hideWindow: () => ipcRenderer.invoke('assistant:hide'),
  onRuntimeLog: callback => {
    const listener = (_event, line) => callback(line)
    ipcRenderer.on('hermes:runtime-log', listener)
    return () => ipcRenderer.removeListener('hermes:runtime-log', listener)
  }
})
