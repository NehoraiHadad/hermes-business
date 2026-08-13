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

// Each stored conversation reopens to ITS OWN transcript (keyed by session id and
// consistent with that session's title/preview above) — resuming must never borrow
// another conversation's history just because a fixture existed.
export const DEMO_TRANSCRIPTS: Record<string, Array<{ role: 'user' | 'assistant'; content: string }>> = {
  'weekly-leads': [
    { role: 'user', content: 'תכין לי סיכום קצר של הלידים החדשים השבוע' },
    {
      role: 'assistant',
      content:
        'בשמחה. עברתי על הלידים החדשים: 18 פניות בסך הכול, מתוכן 6 חמות שכדאי לחזור אליהן עוד היום. רוצה שאכין גם הודעות המשך?'
    }
  ],
  'tomorrow-calendar': [
    { role: 'user', content: 'מה יש לי מחר? תכין אותי לפגישות' },
    {
      role: 'assistant',
      content:
        'יש לך שלוש פגישות מחר. הכנתי נקודות רקע לכל אחת — מי מגיע, מה סוכם בפעם הקודמת ומה כדאי לסגור הפעם. רוצה שאשלח לך את זה גם לטלגרם בבוקר?'
    }
  ],
  'client-followup': [
    { role: 'user', content: 'דני עוד לא חזר אליי על הצעת המחיר. מה עושים?' },
    {
      role: 'assistant',
      content:
        'עברו חמישה ימים מאז ששלחת את ההצעה. ניסחתי הודעת המשך קצרה ועניינית לדני — היא מוכנה וממתינה לאישור שלך לפני שליחה.'
    }
  ],
  'content-plan': [
    { role: 'user', content: 'בוא נסגור את תוכנית התוכן לאוגוסט' },
    {
      role: 'assistant',
      content:
        'סגרנו יחד תוכנית של 8 פרסומים לחודש: שני סיפורי לקוח, שלושה טיפים מקצועיים, שני עדכוני מוצר ופוסט סיכום. הכנתי טיוטה ראשונה לכל אחד.'
    }
  ]
}

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
