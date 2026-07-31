const TOOL_LABELS: Array<[RegExp, string]> = [
  [/google.*calendar|calendar/i, 'בודק את היומן…'],
  [/gmail|email|mail/i, 'עובר על המייל…'],
  [/drive|docs|sheets/i, 'מחפש במסמכי העסק…'],
  [/web_search|search/i, 'מחפש מידע…'],
  [/web_extract|browser/i, 'קורא את המקור…'],
  [/skill/i, 'משתמש בתהליך שלמד…'],
  [/cron|schedule/i, 'מעדכן את המשימה המתוזמנת…'],
  [/terminal|shell|process/i, 'מבצע פעולה במחשב…'],
  [/memory/i, 'נזכר בפרטים הרלוונטיים…'],
  [/file|read|write|edit/i, 'עובד עם הקבצים…']
]

export function humanizeTool(name: string): string {
  return TOOL_LABELS.find(([pattern]) => pattern.test(name))?.[1] ?? 'מתקדם במשימה…'
}

export function approvalCopy(payload: Record<string, unknown>) {
  const command = String(payload.command || '')
  const reason = String(payload.reason || payload.description || '')
  const isMail = /gmail|email|mail|send/i.test(`${command} ${reason}`)
  const isCalendar = /calendar|event|meeting/i.test(`${command} ${reason}`)
  if (isMail) {
    return {
      title: 'העוזר רוצה לשלוח מייל',
      description: reason || 'נדרש אישור לפני שליחת ההודעה.'
    }
  }
  if (isCalendar) {
    return {
      title: 'העוזר רוצה לעדכן את היומן',
      description: reason || 'נדרש אישור לפני יצירת או שינוי אירוע.'
    }
  }
  return {
    title: 'העוזר מבקש אישור לפעולה',
    description: reason || 'כדאי לבדוק את פרטי הפעולה לפני שממשיכים.'
  }
}

export function humanSchedule(schedule: string): string {
  const known: Record<string, string> = {
    '0 8 * * 0-4': 'ימים א׳–ה׳ בשעה 08:00',
    '0 9 * * 0-4': 'ימים א׳–ה׳ בשעה 09:00',
    '0 16 * * 4': 'יום ה׳ בשעה 16:00',
    '0 9 * * 1': 'כל יום ב׳ בשעה 09:00'
  }
  if (known[schedule]) return known[schedule]
  if (/^every\s+/i.test(schedule)) return schedule.replace(/^every\s+/i, 'כל ')
  return schedule
}

export function redactDiagnosticText(text: string): string {
  return text
    .replace(/([?&](?:token|ticket)=)[^&\s]+/gi, '$1<redacted>')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|\d{7,}:[A-Za-z0-9_-]{20,})\b/g, '<redacted>')
    .replace(/("(?:api_key|token|secret|password)"\s*:\s*")[^"]+(")/gi, '$1<redacted>$2')
}
