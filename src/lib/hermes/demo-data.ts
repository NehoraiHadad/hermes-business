import type { ScheduledTask, Session, Skill } from '../../types'

// Fixture data that powers the demo/offline experience. Kept in one place so the
// demo backend stays a thin behaviour shim over stable content.

export const DEMO_SESSIONS: Session[] = [
  {
    id: 'weekly-leads',
    title: 'סיכום לידים שבועי',
    preview: 'סיכמתי את 18 הלידים החדשים וחילקתי לפי דחיפות…',
    started_at: Date.now() / 1000 - 1_800,
    message_count: 12,
    source: 'desktop'
  },
  {
    id: 'tomorrow-calendar',
    title: 'הכנה לפגישות מחר',
    preview: 'יש לך שלוש פגישות. הכנתי נקודות רקע לכל אחת.',
    started_at: Date.now() / 1000 - 86_400,
    message_count: 8,
    source: 'telegram'
  },
  {
    id: 'client-followup',
    title: 'מעקב אחרי הצעת מחיר',
    preview: 'ניסחתי הודעת המשך לדני, ממתין לאישור שלך.',
    started_at: Date.now() / 1000 - 172_800,
    message_count: 6,
    source: 'desktop'
  },
  {
    id: 'content-plan',
    title: 'תוכנית תוכן לאוגוסט',
    preview: 'בנינו יחד תוכנית של 8 פרסומים לחודש הבא.',
    started_at: Date.now() / 1000 - 345_600,
    message_count: 21,
    source: 'cli'
  }
]

export const DEMO_TASKS: ScheduledTask[] = [
  {
    id: 'morning-summary',
    name: 'סיכום בוקר',
    prompt: 'סכם את הפגישות, המיילים החשובים והמשימות להיום.',
    schedule: '0 8 * * 0-4',
    enabled: true,
    deliver: 'telegram',
    last_run: 'היום, 08:00',
    next_run: 'מחר, 08:00'
  },
  {
    id: 'weekly-leads-task',
    name: 'סיכום לידים שבועי',
    prompt: 'הכן סיכום של הלידים החדשים והצע למי לחזור קודם.',
    schedule: '0 16 * * 4',
    enabled: true,
    deliver: 'local',
    last_run: 'יום ה׳, 16:00',
    next_run: 'יום ה׳ הבא, 16:00'
  },
  {
    id: 'invoice-followup',
    name: 'בדיקת חשבוניות פתוחות',
    prompt: 'בדוק אילו חשבוניות עברו את תאריך התשלום והכן טיוטות מעקב.',
    schedule: '0 9 * * 1',
    enabled: false,
    deliver: 'local',
    last_run: 'לפני שבוע',
    next_run: null
  }
]

export const DEMO_SKILLS: Skill[] = [
  {
    name: 'google-workspace',
    description: 'Gmail, Calendar, Drive, Docs ו־Sheets',
    enabled: true,
    provenance: 'bundled',
    usage: 24
  },
  {
    name: 'weekly-lead-summary',
    description: 'מסכם לידים לפי מקור, דחיפות ושלב בתהליך המכירה',
    enabled: true,
    provenance: 'agent',
    usage: 6
  },
  {
    name: 'business-context',
    description: 'היכרות עם העסק, ההעדפות והמגבלות שלך',
    enabled: true,
    provenance: 'agent',
    usage: 18
  },
  {
    name: 'research',
    description: 'חיפוש, אימות וסיכום מידע ממקורות ברשת',
    enabled: true,
    provenance: 'bundled',
    usage: 11
  }
]
