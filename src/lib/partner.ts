// Renderer-side facade over the desktop Business Partner bridge. In the desktop
// build every value is the truth reported by the main process (which owns the
// native Hermes config); in demo/browser mode we compute a faithful local
// preview so the UI is identical. Docker is never "ready" in demo, so a docker
// request always shows the honest fail-closed-to-guard result.

const TIER_LABELS: Record<SandboxTier, string> = {
  off: 'ללא בידוד',
  guard: 'שמירה מקומית (Guard)',
  docker: 'בידוד Docker'
}

export function tierLabel(tier: SandboxTier): string {
  return TIER_LABELS[tier]
}

function approvalSemantics(effective: SandboxTier, hasHostBinds: boolean, hasWritable: boolean): string {
  if (effective === 'docker' && hasHostBinds) {
    return hasWritable
      ? 'בידוד Docker פעיל, אך מכיוון שמחוברות תיקיות מהמחשב (bind mount) כל שכבת אישורי הטרמינל ממשיכה לחול — Docker אינו עוקף אותה. הרשאת קריאה בלבד (:ro) היא ההגנה החזקה ביותר; תיקיות לכתיבה מסתמכות על שמירת נתיבים רגישים חלשה יותר.'
      : 'בידוד Docker פעיל וכל התיקיות מחוברות לקריאה בלבד — שום דבר במחשב אינו ניתן לכתיבה.'
  }
  if (effective === 'docker') {
    return 'בידוד Docker פעיל ללא חיבור תיקיות מהמחשב; שום דבר במחשב אינו ניתן לכתיבה. האישורים נשארים ידניים.'
  }
  if (effective === 'guard') {
    return 'שמירה מקומית (אינו ארגז חול מלא): HERMES_WRITE_SAFE_ROOT מגביל כתיבה/מחיקה/העברה של כלי הקבצים של Hermes לתיקיות שנבחרו בלבד. הוא אינו מגביל קריאה, אינו חוסם כתיבה דרך הטרמינל (shell) או הרצת קוד, ואינו מגביל רשת. האישורים נשארים ידניים ושכבת החסימה של פקודות מסוכנות פעילה.'
  }
  return 'ללא בידוד: הטרמינל רץ מקומית ללא הגבלת נתיב כתיבה. אישור ידני הוא ההגנה היחידה.'
}

function demoPlan(settings: PartnerSettings): SandboxPlan {
  const requested = settings.sandbox
  const degraded = requested === 'docker' // no Docker in demo
  const effective: SandboxTier = degraded ? 'guard' : requested
  const hasWritable = settings.roots.some(root => root.access === 'rw')
  return {
    requested,
    effective,
    backend: 'local',
    isolation: false,
    degraded,
    reason: degraded ? 'Docker אינו זמין בתצוגת הדגמה — עובר לשמירה מקומית.' : null,
    network: false,
    mounts: [],
    invalidRoots: [],
    approvalSemantics: approvalSemantics(effective, settings.roots.length > 0, hasWritable)
  }
}

const DEMO_SETTINGS: PartnerSettings = {
  mode: 'normal',
  sandbox: 'guard',
  network: false,
  checkins: false,
  checkinCadence: 'weekly',
  roots: []
}

// Deterministic deny-all sentinel mirrored from sandbox-roots.denyAllSafeRoot: its
// parent is the partner-settings.json regular file, so Hermes' file tools cannot
// create any write beneath it. Injected whenever partner+guard has zero valid
// writable roots so the demo shows the SAME fail-closed HERMES_WRITE_SAFE_ROOT the
// desktop bridge injects — never null (which Hermes treats as unrestricted).
const DEMO_DENY_ALL_ROOT = 'C:\\Users\\...\\.hermes\\business\\partner-settings.json\\.deny-all'

function demoWriteRoot(settings: PartnerSettings): string | null {
  if (settings.mode !== 'partner' || settings.sandbox !== 'guard') return null
  const writable = settings.roots.filter(root => root.access === 'rw').map(root => root.path)
  return writable.length > 0 ? writable.join(';') : DEMO_DENY_ALL_ROOT
}

let demoState: PartnerState = {
  ...DEMO_SETTINGS,
  plan: demoPlan(DEMO_SETTINGS),
  docker: { ready: false, present: false, status: 'not-requested' },
  backend: 'local',
  personalityActive: false,
  checkin: { scheduled: false, paused: false, jobId: null, scheduleDisplay: null },
  checkinMismatch: false,
  writeRoot: null,
  liveError: null
}

export async function loadPartnerState(): Promise<PartnerState> {
  if (window.hermesDesktop) return window.hermesDesktop.getPartnerState()
  return demoState
}

export async function applyPartner(patch: Partial<PartnerSettings>): Promise<PartnerState> {
  if (window.hermesDesktop) {
    const result = await window.hermesDesktop.applyPartnerMode(patch)
    const state = await window.hermesDesktop.getPartnerState()
    // Never report success when the official cron reconcile failed: a failed
    // opt-out may leave the scheduled check-in active, so surface it loudly.
    if (result?.checkin?.error) {
      throw new Error(
        `סנכרון הצ׳ק־אין מול Hermes נכשל — ייתכן שהמשימה המתוזמנת עדיין פעילה. נסה שוב. (${result.checkin.error})`
      )
    }
    return state
  }
  const merged: PartnerSettings = {
    mode: patch.mode ?? demoState.mode,
    sandbox: patch.sandbox ?? demoState.sandbox,
    network: patch.network ?? demoState.network,
    checkins: patch.checkins ?? demoState.checkins,
    checkinCadence: patch.checkinCadence ?? demoState.checkinCadence,
    roots: patch.roots ?? demoState.roots
  }
  const cadenceLabels: Record<CheckinCadence, string> = {
    daily: 'כל יום ב־08:00',
    weekdays: 'ימים א׳–ה׳ ב־08:00',
    weekly: 'כל יום ראשון ב־08:00'
  }
  const checkinOn = merged.mode === 'partner' && merged.checkins
  demoState = {
    ...demoState,
    ...merged,
    plan: demoPlan(merged),
    personalityActive: merged.mode === 'partner',
    checkin: {
      scheduled: checkinOn,
      paused: false,
      jobId: checkinOn ? 'demo-checkin' : null,
      scheduleDisplay: checkinOn ? cadenceLabels[merged.checkinCadence] : null
    },
    checkinMismatch: false,
    writeRoot: demoWriteRoot(merged)
  }
  return demoState
}

export async function chooseFolder(): Promise<string | null> {
  if (window.hermesDesktop) return window.hermesDesktop.chooseFolder()
  const name = window.prompt('נתיב תיקיה (הדגמה):', 'C:\\Business')
  return name && name.trim() ? name.trim() : null
}
