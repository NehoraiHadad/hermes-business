/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Baked in only by an explicit QA/test build (`vite build --mode qa`). Absent
  // from every normal production release, which is what hard-disables demo
  // fixtures in the shipping executable. See src/lib/hermes/core.ts.
  readonly VITE_ALLOW_DEMO?: string
}

declare global {
  type HermesRuntime = {
    installed: boolean
    running: boolean
    starting: boolean
    mode: string
    version: string | null
    compatible?: boolean
    compatRange?: string
    error: string | null
    wsUrl: string
  }

  type HermesDesktopBridge = {
    getRuntime: () => Promise<HermesRuntime>
    startRuntime: () => Promise<HermesRuntime>
    restartRuntime: () => Promise<HermesRuntime>
    applyUpdate: () => Promise<{ ok: boolean; completed: boolean; version?: string; backupPath?: string }>
    installHermes: () => Promise<{ ok: boolean; installed: boolean; code?: number }>
    api: <T = unknown>(path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<T>
    openFull: (surface: 'desktop' | 'dashboard' | 'logs' | 'settings') => Promise<{ ok: boolean }>
    openExternal: (url: string) => Promise<void>
    chooseFile: (filters?: Array<{ name: string; extensions: string[] }>) => Promise<string | null>
    chooseFolder: () => Promise<string | null>
    getCuratorInsights: () => Promise<import('./lib/hermes/curator').CuratorInsights>
    getPartnerState: () => Promise<PartnerState>
    applyPartnerMode: (patch: Partial<PartnerSettings>) => Promise<{ settings: PartnerSettings; restarted: boolean }>
    startGoogleSetup: (clientSecretPath: string, services: string) => Promise<{ ok: boolean; authUrl: string }>
    finishGoogleSetup: (code: string) => Promise<{ ok: boolean }>
    getGoogleStatus: () => Promise<{ available: boolean; authenticated: boolean }>
    ensureGateway: () => Promise<{ ok: boolean; installed: boolean; running?: boolean }>
    getWhatsappPolicy: () => Promise<WhatsappPolicy>
    setWhatsappPolicy: (policy: WhatsappPolicy) => Promise<WhatsappPolicy>
    ensureWhatsappPolicy: () => Promise<{ ok: boolean; enabled: boolean }>
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

  type WhatsappPolicy = {
    version: 1
    mode: 'read_only' | 'selected_chats'
    reply_chats: string[]
  }

  type PartnerMode = 'normal' | 'partner'
  type SandboxTier = 'off' | 'guard' | 'docker'
  type PartnerRoot = { path: string; access: 'ro' | 'rw' }

  type PartnerSettings = {
    mode: PartnerMode
    sandbox: SandboxTier
    network: boolean
    checkins: boolean
    roots: PartnerRoot[]
  }

  type SandboxMount = { host: string; container: string; ro: boolean; spec: string }

  type SandboxPlan = {
    requested: SandboxTier
    effective: SandboxTier
    backend: 'local' | 'docker'
    isolation: boolean
    degraded: boolean
    reason: string | null
    network: boolean
    mounts: SandboxMount[]
    approvalSemantics: string
  }

  type PartnerState = PartnerSettings & {
    plan: SandboxPlan
    docker: { ready: boolean; present: boolean; status: string; detail?: string | null }
    backend: string | null
    personalityActive: boolean
    writeRoot: string | null
    liveError: string | null
  }

  interface Window {
    hermesDesktop?: HermesDesktopBridge
  }
}

export {}
