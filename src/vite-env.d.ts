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
    applyPartnerMode: (
      patch: Partial<PartnerSettings>
    ) => Promise<{ settings: PartnerSettings; restarted: boolean; checkin?: { error?: string } }>
    startGoogleSetup: (clientSecretPath: string, services: string) => Promise<{ ok: boolean; authUrl: string }>
    finishGoogleSetup: (code: string) => Promise<{ ok: boolean }>
    getGoogleStatus: () => Promise<{ available: boolean; authenticated: boolean }>
    ensureGateway: () => Promise<{ ok: boolean; installed: boolean; running?: boolean }>
    getWhatsappPolicy: () => Promise<WhatsappPolicy>
    setWhatsappPolicy: (policy: WhatsappPolicy) => Promise<WhatsappPolicy>
    ensureWhatsappPolicy: () => Promise<{ ok: boolean; enabled: boolean }>
    // Live guard introspection: the RAW runtime status the messaging-policy guard writes
    // FROM the dispatch process, after the desktop liveness-verifies it (fresh + live pid
    // + gateway role). The app's interpretWhatsappGuard() is the fail-closed parser/trust
    // boundary. Returns null when it cannot be positively proven live (→ BLOCKED in the UI).
    getWhatsappGuard: () => Promise<Record<string, unknown> | null>
    // Real out-of-band credential probe (main process, no CORS). Verifies a provider
    // Hermes cannot itself validate (Anthropic) against its official endpoint.
    probeProvider?: (input: {
      provider: string
      envKey: string
      apiKey: string
      model: string | null
    }) => Promise<{ ok: boolean; reachable: boolean; message?: string }>
    // Real, NON-DESTRUCTIVE liveness probe for an EXISTING Codex OAuth grant. Hits the
    // official `/usage` metadata endpoint (no token rotation, no billable content) so a
    // revoked/expired grant (ok:false) or an unreachable one (reachable:false) can never
    // mint fresh provider evidence. Returns reachable:false when it could not probe.
    probeCodexGrant?: () => Promise<{ ok: boolean; reachable: boolean; message?: string }>
    // Non-secret provider validation evidence, persisted in the Hermes-owned profile.
    getProviderEvidence: () => Promise<import('./lib/provider-validation').ProviderValidation | null>
    recordProviderEvidence: (
      evidence: import('./lib/provider-validation').ProviderValidation
    ) => Promise<import('./lib/provider-validation').ProviderValidation | null>
    getTelegramPolicy: () => Promise<TelegramPolicy>
    setTelegramPolicy: (policy: TelegramPolicy) => Promise<TelegramPolicy>
    ensureTelegramPolicy: () => Promise<{ ok: boolean; enabled: boolean }>
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

  type TelegramPolicy = {
    version: 1
    mode: 'full_access' | 'read_only' | 'selected_chats'
    reply_chats: string[]
  }

  type PartnerMode = 'normal' | 'partner'
  type SandboxTier = 'off' | 'guard' | 'docker'
  type PartnerRoot = { path: string; access: 'ro' | 'rw' }

  type CheckinCadence = 'daily' | 'weekdays' | 'weekly'

  type PartnerSettings = {
    mode: PartnerMode
    sandbox: SandboxTier
    network: boolean
    checkins: boolean
    checkinCadence: CheckinCadence
    roots: PartnerRoot[]
  }

  type SandboxMount = { host: string; container: string; ro: boolean; spec: string }
  type InvalidRoot = { path: string; reason: string }

  type SandboxPlan = {
    requested: SandboxTier
    effective: SandboxTier
    backend: 'local' | 'docker'
    isolation: boolean
    degraded: boolean
    reason: string | null
    network: boolean
    mounts: SandboxMount[]
    invalidRoots: InvalidRoot[]
    approvalSemantics: string
  }

  type CheckinStatus = {
    scheduled: boolean
    paused: boolean
    jobId: string | null
    scheduleDisplay: string | null
    // The actual live schedule expression from the ONE official cron store, and whether
    // it was edited in full Hermes away from the intended cadence.
    liveSchedule?: string | null
    edited?: boolean
  } | null

  type PartnerState = PartnerSettings & {
    plan: SandboxPlan
    docker: { ready: boolean; present: boolean; status: string; detail?: string | null }
    backend: string | null
    personalityActive: boolean
    checkin: CheckinStatus
    // Live official-cron scheduled state diverges from persisted intent (e.g. an
    // opt-out whose pause did not land, or a not-yet-reconciled opt-in).
    checkinMismatch: boolean
    writeRoot: string | null
    liveError: string | null
  }

  interface Window {
    hermesDesktop?: HermesDesktopBridge
  }
}

export {}
