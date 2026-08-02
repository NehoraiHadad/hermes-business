// Canonical, cross-runtime onboarding data contract. Plain JS so BOTH the React /
// Electron wrapper (typed via onboarding-contract.d.ts) and the Rollup-bundled
// Hermes Desktop plugin consume ONE source — no hand-maintained per-language copy.

const ONBOARDING_FIELD_TEMPLATE = {
  userName: '',
  role: 'בעל/ת העסק',
  language: 'עברית',
  responseStyle: 'קצר, ברור ומעשי',
  workHours: '09:00–18:00',
  approvals: ['שליחת הודעות ומיילים', 'מחיקה או שינוי קבצים', 'התחייבות כספית'],
  timeSavers: '',
  businessName: '',
  industry: '',
  offerings: '',
  customers: '',
  businessHours: '',
  communicationStyle: 'מקצועי, חם ולא מתנשא',
  restrictions: '',
  recurringProcesses: '',
  systems: ''
}

// First run is conversation-led. Keep the complete schema, but do not persist
// suggested values as if the owner had confirmed them. The bootstrap Skill may
// use friendly defaults while speaking; durable business facts start unknown.
export const EMPTY_ONBOARDING = {
  ...ONBOARDING_FIELD_TEMPLATE,
  role: '',
  language: '',
  responseStyle: '',
  workHours: '',
  communicationStyle: ''
}

export const ONBOARDING_KEYS = Object.keys(EMPTY_ONBOARDING)

// Legacy plugin fallback-form keys → canonical keys, so persisted user data keeps
// working after unification (migration/normalization, never a silent data loss).
export const LEGACY_ALIASES = {
  name: 'userName',
  answerStyle: 'responseStyle',
  repetitiveTasks: 'timeSavers',
  openingHours: 'businessHours',
  voice: 'communicationStyle',
  forbiddenPromises: 'restrictions',
  processes: 'recurringProcesses'
}

// One canonical, nontechnical Hebrew questionnaire. Both shells derive their form
// from this so field keys can never drift again.
export const ONBOARDING_STEPS = [
  {
    title: 'נעים להכיר',
    copy: 'כמה פרטים שיעזרו לעוזר לעבוד כמו שמתאים לך.',
    fields: [
      { key: 'userName', label: 'שם' },
      { key: 'role', label: 'תפקיד' },
      { key: 'language', label: 'שפה מועדפת' },
      { key: 'responseStyle', label: 'סגנון תשובות' },
      { key: 'workHours', label: 'שעות עבודה' }
    ]
  },
  {
    title: 'העסק',
    copy: 'המידע יישמר ב־Memory וב־Skill של Hermes, לא ב־prompt ענקי.',
    fields: [
      { key: 'businessName', label: 'שם העסק' },
      { key: 'industry', label: 'תחום פעילות' },
      { key: 'offerings', label: 'שירותים ומוצרים', multiline: true },
      { key: 'customers', label: 'סוגי לקוחות' },
      { key: 'businessHours', label: 'שעות פעילות' }
    ]
  },
  {
    title: 'איך נכון לעבוד',
    copy: 'גבולות ברורים ותהליכים שהעוזר יכול לחסוך.',
    fields: [
      { key: 'approvals', label: 'פעולות שדורשות אישור', multiline: true },
      { key: 'communicationStyle', label: 'סגנון התקשורת של העסק', multiline: true },
      { key: 'restrictions', label: 'מגבלות והתחייבויות שאסור לתת', multiline: true },
      { key: 'recurringProcesses', label: 'תהליכים חוזרים', multiline: true },
      { key: 'systems', label: 'מערכות וקבצים בשימוש', multiline: true },
      { key: 'timeSavers', label: 'משימות שתרצה לחסוך', multiline: true }
    ]
  }
]

// Shared persistence keys so the simple shell and full Hermes agree on state.
export const STORAGE_KEYS = {
  complete: 'hermes-business-onboarding-v1',
  form: 'onboarding',
  guided: 'guidedSetup',
  pluginComplete: 'onboardingComplete'
}

function toList(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[\n,]/).map(item => item.trim()).filter(Boolean)
  return []
}

// Normalize any persisted/partial shape (React form, legacy plugin form) into the
// one canonical contract, preserving every value the user already gave us.
export function normalizeOnboarding(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const out = { ...EMPTY_ONBOARDING, approvals: [...EMPTY_ONBOARDING.approvals] }
  for (const key of ONBOARDING_KEYS) {
    if (key === 'approvals') continue
    if (source[key] != null && source[key] !== '') out[key] = source[key]
  }
  for (const [legacy, canonical] of Object.entries(LEGACY_ALIASES)) {
    const missing = out[canonical] == null || out[canonical] === '' || out[canonical] === EMPTY_ONBOARDING[canonical]
    if (missing && source[legacy] != null && source[legacy] !== '') out[canonical] = source[legacy]
  }
  const approvals = source.approvals != null ? source.approvals : out.approvals
  out.approvals = toList(approvals)
  if (out.approvals.length === 0) out.approvals = [...EMPTY_ONBOARDING.approvals]
  return out
}
