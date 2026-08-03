import type { CodexGrantProbe } from '../codex-existing-grant'
import type { ProviderValidation } from '../provider-validation'
import type { WhatsappPolicy, WhatsappSource } from '../whatsapp-policy'
import type { CuratorInsights } from './curator'

// Typed desktop-bridge surface, owned by the HermesClient facade.
//
// Everything the renderer needs from the Electron main process that is NOT gateway
// RPC or dashboard REST lives here: Google OAuth setup, the WhatsApp policy/guard
// files, curator insights, provider evidence, runtime lifecycle and the OS shell
// affordances. Routing it through the facade gives all three runtime modes ONE
// meaning, so product code never has to ask `if (hermesClient.demo)`:
//   • bridge present  → delegate to window.hermesDesktop
//   • demo            → a faithful fixture from the strippable demo subtree
//   • bridge missing  → throw, exactly like rpc()/api() — never a fabricated "ok"
//
// DELIBERATELY NOT HERE: the Electron window controls (mini/full mode, always-on-top
// pin, hide) used by useAssistantWindow. Those move the app's OWN window — they carry
// no Hermes data, there is nothing a demo fixture could faithfully stand in for (the
// window either exists or the app is running in a browser tab), and they are already
// correct no-ops without a bridge. A demo-swappable indirection there would add
// ceremony and zero honesty, so useAssistantWindow keeps its direct bridge calls.

export const BRIDGE_UNAVAILABLE = 'Hermes desktop bridge is unavailable'

export type FullSurface = 'desktop' | 'dashboard' | 'logs' | 'settings'
export type FileFilter = { name: string; extensions: string[] }
export type OpenSurfaceResult = { ok: boolean; message?: string }

export interface HermesDesktopApi {
  /** True only when picking a file opens the real OS dialog and yields a host path
   *  Hermes can read directly. Browser/demo sessions must stage bytes instead. */
  readonly hasNativeFileDialog: boolean

  // --- runtime lifecycle & support ---------------------------------------
  restartRuntime(): Promise<HermesRuntime>
  installHermes(): Promise<{ ok: boolean; installed: boolean; code?: number }>
  createDiagnostics(): Promise<{ ok: boolean; canceled?: boolean; path?: string }>
  getVersions(): Promise<Record<string, string>>

  // --- OS shell ----------------------------------------------------------
  /** `ok:false` means "not opened here" (e.g. demo) and carries the honest reason. */
  openFullSurface(surface: FullSurface): Promise<OpenSurfaceResult>
  openExternal(url: string): Promise<void>
  chooseFile(filters?: FileFilter[]): Promise<string | null>

  // --- Google Workspace OAuth -------------------------------------------
  startGoogleSetup(clientSecretPath: string): Promise<{ ok: boolean; authUrl: string }>
  finishGoogleSetup(redirectUrl: string): Promise<{ ok: boolean }>
  getGoogleStatus(): Promise<{ available: boolean; authenticated: boolean }>

  // --- WhatsApp safety policy & live guard -------------------------------
  getWhatsappPolicy(): Promise<WhatsappPolicy>
  setWhatsappPolicy(policy: WhatsappPolicy): Promise<WhatsappPolicy>
  /** The safety PRECONDITION for any WhatsApp channel: the messaging-policy guard
   *  must be installed and enabled before a channel may be paired or configured. */
  ensureWhatsappPolicy(): Promise<{ ok: boolean; enabled: boolean }>
  getWhatsappDirectory(): Promise<WhatsappSource[]>
  /** RAW guard status; interpretWhatsappGuard() is the fail-closed trust boundary. */
  getWhatsappGuard(): Promise<Record<string, unknown> | null>

  // --- learning / curator -------------------------------------------------
  getCuratorInsights(): Promise<CuratorInsights>

  // --- partner visibility feed --------------------------------------------
  /** Raw, allow-list-projected snapshot (docs/specs/partner-feed.md §4.1) —
   *  cron runs + background sessions + curator insights. `available:false`
   *  means every source failed; the renderer must show that honestly, never
   *  as "no activity". */
  getPartnerFeed(): Promise<PartnerFeedSnapshot>

  // --- provider evidence --------------------------------------------------
  recordProviderEvidence(evidence: ProviderValidation): Promise<ProviderValidation | null>
  /** `null` = the probe capability is unavailable, which callers must treat as
   *  "unproven" (fail closed) — never as a passing grant. */
  probeCodexGrant(): Promise<CodexGrantProbe | null>
}

export type BridgeAccessor = () => HermesDesktopBridge | undefined

// Live delegation to the preload bridge. A missing bridge (or a bridge missing the
// method, e.g. an older preload) produces the same honest error rpc()/api() raise.
//
// Every method is `async`, so an absent bridge REJECTS rather than throwing
// synchronously. That matters: call sites legitimately write
// `hermesClient.getWhatsappGuard().catch(...)`, and a synchronous throw would sail
// straight past that catch and take the caller down instead of degrading.
function createBridgeDesktop(getBridge: BridgeAccessor): HermesDesktopApi {
  function need<K extends keyof HermesDesktopBridge>(method: K): NonNullable<HermesDesktopBridge[K]> {
    const impl = getBridge()?.[method]
    if (!impl) throw new Error(BRIDGE_UNAVAILABLE)
    return impl as NonNullable<HermesDesktopBridge[K]>
  }

  return {
    hasNativeFileDialog: Boolean(getBridge()?.chooseFile),

    async restartRuntime() {
      return need('restartRuntime')()
    },
    async installHermes() {
      return need('installHermes')()
    },
    async createDiagnostics() {
      return need('createDiagnostics')()
    },
    async getVersions() {
      return need('getVersions')()
    },

    async openFullSurface(surface) {
      return need('openFull')(surface)
    },
    async openExternal(url) {
      return need('openExternal')(url)
    },
    async chooseFile(filters) {
      return need('chooseFile')(filters)
    },

    async startGoogleSetup(clientSecretPath) {
      return need('startGoogleSetup')(clientSecretPath)
    },
    async finishGoogleSetup(redirectUrl) {
      return need('finishGoogleSetup')(redirectUrl)
    },
    async getGoogleStatus() {
      return need('getGoogleStatus')()
    },

    async getWhatsappPolicy() {
      return need('getWhatsappPolicy')()
    },
    async setWhatsappPolicy(policy) {
      return need('setWhatsappPolicy')(policy)
    },
    async ensureWhatsappPolicy() {
      return need('ensureWhatsappPolicy')()
    },
    async getWhatsappDirectory() {
      return need('getWhatsappDirectory')()
    },
    async getWhatsappGuard() {
      return need('getWhatsappGuard')()
    },

    async getCuratorInsights() {
      return need('getCuratorInsights')()
    },

    async getPartnerFeed() {
      return need('getPartnerFeed')()
    },

    async recordProviderEvidence(evidence) {
      return need('recordProviderEvidence')(evidence)
    },
    // Optional capability: report its ABSENCE as null rather than rejecting, because
    // gateExistingCodexGrant() already fails closed on a null probe and the caller
    // must show "could not verify", not "the bridge is broken".
    async probeCodexGrant() {
      const probe = getBridge()?.probeCodexGrant
      return probe ? probe() : null
    }
  }
}

// One chokepoint, three modes. `demo` is the fixture backend from the demo subtree
// (absent — and physically stripped — from any production build).
export function createHermesDesktop(getBridge: BridgeAccessor, demo?: HermesDesktopApi): HermesDesktopApi {
  return demo ?? createBridgeDesktop(getBridge)
}
