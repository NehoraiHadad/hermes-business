/// <reference types="vite/client" />

declare global {
  type HermesRuntime = {
    installed: boolean
    running: boolean
    starting: boolean
    mode: string
    version: string | null
    error: string | null
    wsUrl: string
  }

  type HermesDesktopBridge = {
    getRuntime: () => Promise<HermesRuntime>
    startRuntime: () => Promise<HermesRuntime>
    restartRuntime: () => Promise<HermesRuntime>
    installHermes: () => Promise<{ ok: boolean; installed: boolean; code?: number }>
    api: <T = unknown>(path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<T>
    openFull: (surface: 'desktop' | 'dashboard' | 'logs' | 'settings') => Promise<{ ok: boolean }>
    openExternal: (url: string) => Promise<void>
    chooseFile: (filters?: Array<{ name: string; extensions: string[] }>) => Promise<string | null>
    startGoogleSetup: (clientSecretPath: string, services: string) => Promise<{ ok: boolean; authUrl: string }>
    finishGoogleSetup: (code: string) => Promise<{ ok: boolean }>
    getGoogleStatus: () => Promise<{ available: boolean; authenticated: boolean }>
    createDiagnostics: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>
    getRecentLogs: () => Promise<{ lines: string[] }>
    getVersions: () => Promise<Record<string, string>>
    getWindowState: () => Promise<AssistantWindowState>
    setWindowMode: (mode: 'mini' | 'full') => Promise<AssistantWindowState>
    setAlwaysOnTop: (value: boolean) => Promise<AssistantWindowState>
    hideWindow: () => Promise<AssistantWindowState>
    onRuntimeLog: (callback: (line: string) => void) => () => void
  }

  type AssistantWindowState = {
    mode: 'mini' | 'full'
    alwaysOnTop: boolean
    visible: boolean
  }

  interface Window {
    hermesDesktop?: HermesDesktopBridge
  }
}

export {}
