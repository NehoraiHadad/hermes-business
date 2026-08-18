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

// Faithful stand-in for the `hermes:partner:feed` snapshot (docs/specs/partner-feed.md
// §4.1): one check-in run, one Telegram background session, curator — the SAME
// DEMO_CURATOR fixture getCuratorInsights() returns, so the feed and the Skills
// screen never show two different stories about the curator.
const DEMO_PARTNER_FEED: PartnerFeedSnapshot = {
  generatedAt: new Date().toISOString(),
  available: true,
  cron: {
    ok: true,
    jobs: [
      {
        id: 'demo-checkin',
        name: 'צ׳ק־אין שותף עסקי · כל יום ראשון ב־08:00 [hermes-business-partner-checkin:brief:weekly]',
        enabled: true,
        schedule_display: 'כל יום ראשון ב־08:00',
        last_run_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        last_status: 'ok',
        next_run_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        isPartnerCheckin: true,
        runs: [
          {
            id: 'cron_demo-checkin_1730000000',
            title: 'צ׳ק־אין שותף עסקי',
            started_at: Math.floor(Date.now() / 1000) - 5 * 60 * 60,
            ended_at: Math.floor(Date.now() / 1000) - 5 * 60 * 60 + 240,
            message_count: 6,
            is_active: false
          }
        ]
      }
    ]
  },
  sessions: {
    ok: true,
    rows: [
      {
        id: 'demo-telegram-session',
        source: 'telegram',
        title: 'שיחה עם דני כהן',
        preview: 'תודה על העדכון, נדבר מחר בבוקר',
        started_at: Math.floor(Date.now() / 1000) - 20 * 60,
        last_active: Math.floor(Date.now() / 1000) - 18 * 60,
        message_count: 4
      }
    ]
  },
  curator: { ok: true, insights: DEMO_CURATOR }
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

    async getPartnerFeed() {
      return DEMO_PARTNER_FEED
    },

    async recordProviderEvidence(evidence) {
      return evidence
    },
    async probeCodexGrant() {
      return { ok: true, reachable: true, usedPercent: 34 }
    },

    // A demo session never talks to api.github.com — a FIXED unknown verdict
    // (never a fabricated 'up-to-date'/'update-available') and no passive
    // events, since there is no main-process timer behind the fixture backend.
    async checkCompanionUpdate() {
      return {
        status: 'unknown',
        current: '0.4.0-demo',
        checkedAt: null,
        message: 'בדיקת עדכון אינה זמינה בדמו'
      }
    },
    onCompanionUpdateAvailable() {
      return () => {}
    },

    // A demo session downloads and runs nothing: there is no main process to
    // fetch an installer, hash it or launch it. Every action therefore refuses
    // honestly (a structured, Hebrew, "nothing was changed" verdict — the same
    // shape a real failure has) instead of pretending an update flow happened.
    async downloadCompanionUpdate() {
      return { ok: false, code: 'demo', message: 'עדכון אינו זמין בהדגמה. לא בוצע שינוי.' }
    },
    async cancelCompanionDownload() {
      return { ok: true, cancelled: false }
    },
    async applyCompanionUpdate() {
      return { ok: false, code: 'demo', message: 'התקנת עדכון אינה זמינה בהדגמה. לא בוצע שינוי.' }
    },
    async companionUpdateState() {
      return { phase: null, targetVersion: null, currentVersion: '0.4.0-demo', direction: null }
    },
    async companionRollbackOffer() {
      return {
        available: false,
        target: null,
        from: null,
        code: 'demo',
        message: 'חזרה לגרסה קודמת אינה זמינה בהדגמה.'
      }
    },
    async downloadCompanionRollback() {
      return { ok: false as const, code: 'demo', message: 'חזרה לגרסה קודמת אינה זמינה בהדגמה. לא בוצע שינוי.' }
    },
    onCompanionDownloadProgress() {
      return () => {}
    }
  }
}
