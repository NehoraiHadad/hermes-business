import { DEFAULT_WHATSAPP_POLICY, type WhatsappPolicy, type WhatsappSource } from '../whatsapp-policy'
import type { CuratorInsights } from './curator'
import type { HermesDesktopApi } from './desktop'

// Offline stand-in for the Electron desktop bridge, mirroring demo-rpc/demo-api for
// the main-process surface. Reachable ONLY through createDemoBackend() in demo.ts,
// which a non-demo build replaces with a throwing stub — so these fixtures are
// tree-shaken out of the shipping executable exactly like the RPC/REST ones.
//
// Every fixture is a FAITHFUL stand-in, not a rubber stamp: the WhatsApp policy the
// picker edits is the same object the guard status reports, so the demo exercises the
// real safety precondition (ensureWhatsappPolicy) instead of skipping it.

const DEMO_DIRECTORY: WhatsappSource[] = [
  { id: '972500000001', name: 'דני כהן', type: 'dm', platform: 'whatsapp' },
  { id: '972500000002', name: 'נועה לוי', type: 'dm', platform: 'whatsapp' },
  { id: '120363000000000001@g.us', name: 'צוות אלומה', type: 'group', platform: 'whatsapp' },
  { id: '972500000003', name: 'שירות לקוחות (Cloud)', type: 'dm', platform: 'whatsapp_cloud' }
]

const DEMO_CURATOR: CuratorInsights = {
  available: true,
  curator: {
    enabled: true,
    paused: false,
    interval_hours: 12,
    last_run_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
  },
  learning: { stats: { learned_skills: 2, nodes: 34, memories: 12 } }
}

const DEMO_RUNTIME: HermesRuntime = {
  installed: true,
  running: true,
  starting: false,
  mode: 'demo',
  version: '0.19.0',
  error: null,
  wsUrl: ''
}

export function createDemoDesktop(): HermesDesktopApi {
  // Live demo state: the policy the form writes is the policy the guard reports.
  let policy: WhatsappPolicy = { ...DEFAULT_WHATSAPP_POLICY }

  return {
    // A browser/demo session has no OS file dialog; composers must stage real bytes.
    hasNativeFileDialog: false,

    async restartRuntime() {
      return DEMO_RUNTIME
    },
    async installHermes() {
      return { ok: true, installed: true }
    },
    async createDiagnostics() {
      return { ok: true, path: 'C:\\Demo\\hermes-diagnostics-demo.zip' }
    },
    async getVersions() {
      return { hermes: '0.19.0', shell: '0.1.0' }
    },

    // There is no full Hermes window to raise in a browser session. Say so instead of
    // reporting a surface that never opened.
    async openFullSurface(surface) {
      return { ok: false, message: `ביישום המותקן ייפתח כעת ${surface}` }
    },
    async openExternal() {
      // No browser hand-off in the fixture backend; the demo flows never leave the app.
    },
    async chooseFile() {
      return 'client_secret_demo.json'
    },

    async startGoogleSetup() {
      return { ok: true, authUrl: 'https://accounts.google.com/o/oauth2/auth?demo=1' }
    },
    async finishGoogleSetup() {
      return { ok: true }
    },
    async getGoogleStatus() {
      return { available: true, authenticated: false }
    },

    async getWhatsappPolicy() {
      return policy
    },
    async setWhatsappPolicy(next) {
      policy = next
      return policy
    },
    // The demo backend SATISFIES the safety precondition rather than letting callers
    // skip it, so the guard check runs on the same code path as the desktop build.
    async ensureWhatsappPolicy() {
      return { ok: true, enabled: true }
    },
    async getWhatsappDirectory() {
      return DEMO_DIRECTORY
    },
    // Shaped exactly like the raw runtime status the messaging-policy guard publishes,
    // so interpretWhatsappGuard() parses it through its real trust boundary.
    async getWhatsappGuard() {
      return {
        plugin_loaded: true,
        enforcing: true,
        hooks: ['pre_gateway_dispatch'],
        mode: policy.mode,
        reply_chats: policy.reply_chats.length
      }
    },

    async getCuratorInsights() {
      return DEMO_CURATOR
    },

    async recordProviderEvidence(evidence) {
      return evidence
    },
    async probeCodexGrant() {
      return { ok: true, reachable: true }
    }
  }
}
