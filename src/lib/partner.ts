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
    return 'שמירה מקומית: HERMES_WRITE_SAFE_ROOT מגביל כתיבה/מחיקה/העברה לתיקיות שנבחרו בלבד — הוא אינו מגביל קריאה או הרצת טרמינל. האישורים נשארים ידניים ושכבת החסימה של פקודות מסוכנות פעילה.'
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
    approvalSemantics: approvalSemantics(effective, settings.roots.length > 0, hasWritable)
  }
}

let demoState: PartnerState = {
  mode: 'normal',
  sandbox: 'guard',
  network: false,
  checkins: false,
  roots: [],
  plan: demoPlan({ mode: 'normal', sandbox: 'guard', network: false, checkins: false, roots: [] }),
  docker: { ready: false, present: false, status: 'not-requested' },
  backend: 'local',
  personalityActive: false,
  writeRoot: null,
  liveError: null
}

export async function loadPartnerState(): Promise<PartnerState> {
  if (window.hermesDesktop) return window.hermesDesktop.getPartnerState()
  return demoState
}

export async function applyPartner(patch: Partial<PartnerSettings>): Promise<PartnerState> {
  if (window.hermesDesktop) {
    await window.hermesDesktop.applyPartnerMode(patch)
    return window.hermesDesktop.getPartnerState()
  }
  const merged: PartnerSettings = {
    mode: patch.mode ?? demoState.mode,
    sandbox: patch.sandbox ?? demoState.sandbox,
    network: patch.network ?? demoState.network,
    checkins: patch.checkins ?? demoState.checkins,
    roots: patch.roots ?? demoState.roots
  }
  demoState = {
    ...demoState,
    ...merged,
    plan: demoPlan(merged),
    personalityActive: merged.mode === 'partner',
    writeRoot: merged.mode === 'partner' && merged.sandbox === 'guard'
      ? merged.roots.filter(root => root.access === 'rw').map(root => root.path).join(';') || null
      : null
  }
  return demoState
}

export async function chooseFolder(): Promise<string | null> {
  if (window.hermesDesktop) return window.hermesDesktop.chooseFolder()
  const name = window.prompt('נתיב תיקיה (הדגמה):', 'C:\\Business')
  return name && name.trim() ? name.trim() : null
}
