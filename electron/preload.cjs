const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hermesDesktop', {
  getRuntime: () => ipcRenderer.invoke('hermes:runtime'),
  startRuntime: () => ipcRenderer.invoke('hermes:start'),
  restartRuntime: () => ipcRenderer.invoke('hermes:restart'),
  installHermes: () => ipcRenderer.invoke('hermes:install'),
  api: (path, init) => ipcRenderer.invoke('hermes:api', path, init),
  openFull: surface => ipcRenderer.invoke('hermes:open-full', surface),
  openExternal: url => ipcRenderer.invoke('hermes:open-external', url),
  chooseFile: filters => ipcRenderer.invoke('hermes:choose-file', filters),
  startGoogleSetup: (clientSecretPath, services) =>
    ipcRenderer.invoke('hermes:google:start', clientSecretPath, services),
  finishGoogleSetup: code => ipcRenderer.invoke('hermes:google:finish', code),
  getGoogleStatus: () => ipcRenderer.invoke('hermes:google:status'),
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
