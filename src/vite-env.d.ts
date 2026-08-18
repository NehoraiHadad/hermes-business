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
    isolated?: boolean
    hermesHome?: string | null
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
    // Partner visibility feed (docs/specs/partner-feed.md §4.1): main-process
    // aggregation of cron-job runs, background (Telegram/WhatsApp/…) sessions and
    // curator insights, allow-list projected in electron/partner-feed.cjs before
    // crossing this boundary — never a raw job/session payload.
    getPartnerFeed: () => Promise<PartnerFeedSnapshot>
    getPartnerState: () => Promise<PartnerState>
    applyPartnerMode: (
      patch: Partial<PartnerSettings>
    ) => Promise<{ settings: PartnerSettings; restarted: boolean; checkin?: { error?: string } }>
    startGoogleSetup: (clientSecretPath: string) => Promise<{ ok: boolean; authUrl: string }>
    finishGoogleSetup: (code: string) => Promise<{ ok: boolean }>
    getGoogleStatus: () => Promise<{ available: boolean; authenticated: boolean }>
    ensureGateway: () => Promise<{ ok: boolean; installed: boolean; running?: boolean }>
    getWhatsappPolicy: () => Promise<WhatsappPolicy>
    getWhatsappDirectory: () => Promise<WhatsappSource[]>
    setWhatsappPolicy: (policy: WhatsappPolicy) => Promise<WhatsappPolicy>
    ensureWhatsappPolicy: () => Promise<{ ok: boolean; enabled: boolean }>
    // Live guard introspection: the RAW runtime status the messaging-policy guard writes
    // FROM the dispatch process, after the desktop liveness-verifies it (fresh + live pid
    // + gateway role). The app's interpretWhatsappGuard() is the fail-closed parser/trust
    // boundary. Returns null when it cannot be positively proven live (→ BLOCKED in the UI).
    getWhatsappGuard: () => Promise<Record<string, unknown> | null>
    // Observable phase of the guard-ACTIVATION transaction (plugin update → gateway
    // restart → verify). Null when no transaction has been journalled.
    getWhatsappGuardActivation: () => Promise<WhatsappGuardActivation | null>
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
    // `usedPercent`/`quotaExhausted` are DISPLAY-ONLY extras (the worst rate-limit window /
    // a known-exhausted quota) — the evidence gate keys off ok/reachable alone.
    probeCodexGrant?: () => Promise<{
      ok: boolean
      reachable: boolean
      message?: string
      usedPercent?: number | null
      quotaExhausted?: boolean
    }>
    // Non-secret provider validation evidence, persisted in the Hermes-owned profile.
    getProviderEvidence: () => Promise<import('./lib/provider-validation').ProviderValidation | null>
    recordProviderEvidence: (
      evidence: import('./lib/provider-validation').ProviderValidation
    ) => Promise<import('./lib/provider-validation').ProviderValidation | null>
    createDiagnostics: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>
    getRecentLogs: () => Promise<{ lines: string[] }>
    getVersions: () => Promise<Record<string, string>>
    getWindowState: () => Promise<AssistantWindowState>
    setWindowMode: (mode: 'mini' | 'full') => Promise<AssistantWindowState>
    setAlwaysOnTop: (value: boolean) => Promise<AssistantWindowState>
    hideWindow: () => Promise<AssistantWindowState>
    onRuntimeLog: (callback: (line: string) => void) => () => void
    // תכל'ס (companion) self-update CHECK ONLY (docs/specs/versioning.md §6.4):
    // main owns the fetch/parse/decision entirely — this call returns the scalar
    // verdict, never rejects (main-side fail-closed contract, §8).
    checkCompanionUpdate: (force: boolean) => Promise<CompanionUpdateStatus>
    // Passive push (§6.5): a ONE-SHOT event fired by the main-process startup
    // timer only when it found an update-available verdict.
    onCompanionUpdateAvailable: (callback: (status: CompanionUpdateStatus) => void) => () => void
    // The two CONSENTED actions (§7). They take NO arguments by design: main
    // derives every operand from artifacts it produced itself (the verdict, the
    // durable journal), so the renderer cannot redirect a download or name a
    // file to execute. See electron/ipc-companion-update.cjs.
    downloadCompanionUpdate: () => Promise<CompanionDownloadResult>
    cancelCompanionDownload: () => Promise<{ ok: boolean; cancelled: boolean }>
    // On SUCCESS the app quits, so this promise never settles; it resolves only
    // when the apply was refused.
    applyCompanionUpdate: () => Promise<CompanionApplyRefusal>
    companionUpdateState: () => Promise<CompanionUpdateJournalState>
    // Rollback (§7.5). Argument-free for the same reason, and more strictly so:
    // this one moves the install BACKWARDS, and the destination is read out of
    // main's own durable journal. A renderer able to name the version would be
    // able to name ANY version — the exact downgrade primitive the forward
    // path's "strictly newer" rule denies.
    companionRollbackOffer: () => Promise<CompanionRollbackOffer>
    downloadCompanionRollback: () => Promise<CompanionDownloadResult>
    onCompanionDownloadProgress: (callback: (progress: CompanionDownloadProgress) => void) => () => void
  }

  // Is a one-step return to the previous version on offer? `available:false`
  // always carries a `code` and a Hebrew `message` saying WHY — "no previous
  // version was ever recorded here" is a different fact from "it is no longer
  // published", and the UI says which.
  type CompanionRollbackOffer = {
    available: boolean
    target: string | null
    from: string | null
    code: string | null
    message: string | null
  }

  // Streamed-download progress (electron/companion-download.cjs). `totalBytes` is
  // null when the response carried no usable Content-Length — the UI must render
  // an indeterminate bar rather than inventing a denominator.
  type CompanionDownloadProgress = {
    receivedBytes: number
    totalBytes: number | null
    phase: 'manifest' | 'downloading' | 'verifying' | 'ready'
  }

  // Never-rejects contract, same doctrine as the check (§8): every failure is a
  // structured verdict with a Hebrew, user-safe `message` that states the machine
  // was not changed.
  type CompanionDownloadResult =
    | { ok: true; version: string; bytes: number; sha256: string; message?: string }
    | { ok: false; code: string; message: string; detail?: string }

  type CompanionApplyRefusal = { ok: false; code: string; message: string }

  // Read-only projection of the durable update journal. The installer PATH is
  // deliberately absent — the renderer has no legitimate use for it and cannot
  // pass one back.
  type CompanionUpdateJournalState = {
    phase: 'downloading' | 'verifying' | 'ready' | 'applying' | null
    targetVersion: string | null
    currentVersion: string
    // Which way a pending record points, decided in MAIN by the one SemVer
    // implementation. `null` means the two versions could not be ordered — the
    // UI must then say nothing about direction rather than guess.
    direction: 'forward' | 'rollback' | null
  }

  // Wire contract of `hermes:companion-update` / `hermes:companion-update-available`
  // (docs/specs/versioning.md §6.2). Scalars only — no raw GitHub response object
  // ever crosses this boundary. `status` is exactly one of the four verdicts §6.1
  // decides; `up-to-date` is reported ONLY on a complete positive proof, never as
  // a default — either the running version matched the winning release, or a
  // provably COMPLETE scan of a NON-EMPTY release census found nothing newer
  // published at all (in which case `latest` is absent). An empty census is
  // content-free and stays `unknown`. `unknown` means "could not determine",
  // NOT "found nothing". `checkedAt` is epoch ms of the last SUCCESSFUL check, or `null`
  // before any check has completed.
  type CompanionUpdateStatus = {
    status: 'update-available' | 'up-to-date' | 'dev-ahead' | 'unknown'
    current: string
    latest?: string
    releaseName?: string
    notes?: string
    downloadUrl?: string
    publishedAt?: string
    checkedAt: number | null
    message?: string
    // ---- managed (one-click) update -----------------------------------------
    // Present ONLY on an `update-available` verdict. `managedUpdate` states
    // whether this release actually carries the two assets a managed update
    // needs — the pinned installer `Tachles-Setup-<latest>.exe` and the signed
    // `update-manifest.json` — with both URLs allow-listed in main against
    // `https://github.com/NehoraiHadad/hermes-business/releases/download/`.
    //
    // `false` is an HONEST, expected state (an older release, or one published
    // without a manifest), never an error: `downloadUrl` (the release page) stays
    // the manual fallback and the UI keeps offering it. `managedUpdateReason`
    // carries the code that says which half is missing
    // (`assets-absent` | `installer-asset-absent` | `manifest-asset-absent` |
    //  `installer-url-rejected` | `manifest-url-rejected` | `version-absent`).
    managedUpdate?: boolean
    managedUpdateReason?: string
    installerUrl?: string
    manifestUrl?: string
  }

  // Durable record written by electron/whatsapp-guard-journal.cjs for the guard
  // activation transaction: 'restarting' → 'verifying' → 'active' | 'failed'. While it
  // is in-flight or failed, `supersedeNonce` pins the PRE-restart heartbeat so the
  // status reader fails closed on the old gateway's proof.
  type WhatsappGuardActivation = {
    schema: number
    updatedAt: string
    status: 'restarting' | 'verifying' | 'active' | 'failed'
    changed?: boolean
    supersedeNonce?: string
    expectedVersion?: string | null
    reason?: string
  }

  type AssistantWindowState = {
    mode: 'mini' | 'full'
    alwaysOnTop: boolean
    visible: boolean
  }

  type WhatsappPolicy = {
    version: 2
    mode: 'read_only' | 'selected_chats'
    behavior: 'monitor' | 'assist'
    instructions: string
    reply_chats: string[]
    reply_groups: string[]
    sources: WhatsappSource[]
  }
  type WhatsappSource = {
    id: string
    name: string
    type: 'dm' | 'group'
    platform: 'whatsapp' | 'whatsapp_cloud'
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

  // Partner visibility feed (docs/specs/partner-feed.md §4.1) — the wire contract
  // of the `hermes:partner:feed` channel. Every field crossing this boundary is
  // allow-list projected in electron/partner-feed.cjs; a field NOT listed here
  // (prompt/deliver/system_prompt/tokens/cwd) never leaves the main process.
  // Fail-closed doctrine: an unproven field is `null`, a failed source is
  // `ok:false` with an EMPTY list — never a fabricated "healthy" empty list.
  type PartnerFeedSnapshot = {
    generatedAt: string // ISO, when main collected this evidence
    available: boolean // at least one source answered (like CuratorInsights.available)
    cron: { ok: boolean; jobs: FeedCronJob[] }
    sessions: { ok: boolean; rows: FeedSessionRow[] }
    curator: { ok: boolean; insights: import('./lib/hermes/curator').CuratorInsights | null }
  }

  type FeedCronJob = {
    id: string
    name: string
    enabled: boolean
    schedule_display: string | null
    last_run_at: string | null // ISO from Hermes; null = never run / not reported
    last_status: 'ok' | 'error' | null // null = not reported (fail-closed: not "succeeded")
    next_run_at: string | null
    isPartnerCheckin: boolean // isOwnedCheckin() from electron/partner-checkin-def.cjs
    runs: FeedRunRow[] // up to 3 most recent, only for jobs that ran within the window
  }

  type FeedRunRow = {
    id: string // session id: cron_{job_id}_{timestamp}
    title: string | null
    started_at: number | null // epoch seconds, as Hermes returns it
    ended_at: number | null
    message_count: number
    is_active: boolean
  }

  type FeedSessionRow = {
    id: string
    source: string // 'telegram' / 'whatsapp' / any platform
    title: string | null
    preview: string | null
    started_at: number | null
    last_active: number | null
    message_count: number
  }

  interface Window {
    hermesDesktop?: HermesDesktopBridge
  }
}

export {}
