import { humanizeSchedule } from './schedule'

type ToolPayload = Record<string, unknown>

function toolArguments(payload: ToolPayload): ToolPayload {
  const value = payload.arguments || payload.args || payload.input || payload.parameters
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as ToolPayload) : {}
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as ToolPayload) : {}
}

function readableToolName(name: string) {
  const leaf = name.split(/[.:/]/).filter(Boolean).at(-1) || ''
  const readable = leaf.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return /^[\p{L}\p{N} ]{1,48}$/u.test(readable) ? readable : ''
}

function terminalActivity(command: string) {
  if (/\b(?:npm|pnpm|yarn|vitest|jest|pytest)\b[^\r\n]*(?:test|check)/i.test(command)) return 'מריץ בדיקות'
  if (/\bgit\s+(?:status|diff|log|show)\b/i.test(command)) return 'בודק את שינויי הקוד'
  if (/\bgit\s+(?:add|commit|push|pull|merge|rebase)\b/i.test(command)) return 'מעדכן את מאגר הקוד'
  if (/\b(?:rg|grep|findstr|select-string)\b/i.test(command)) return 'מחפש בקבצי המחשב'
  if (/\b(?:gmail|google|calendar|drive)\b/i.test(command)) return 'בודק נתוני Google דרך המחשב'
  if (/\b(?:python|python3|py)\b/i.test(command)) return 'מריץ סקריפט Python'
  if (/\b(?:powershell|pwsh)\b/i.test(command)) return 'מריץ פקודת PowerShell'
  return 'מריץ פקודת מערכת'
}

export function humanizeTool(name: string, payload: ToolPayload = {}): string {
  const normalized = name.toLowerCase()
  const args = toolArguments(payload)
  const action = String(payload.action || args.action || normalized).toLowerCase()
  const command = String(payload.command || args.command || args.cmd || args.script || '')

  if (/google.*calendar|calendar/.test(normalized)) {
    if (/create|add|schedule/.test(action)) return 'יוצר אירוע ביומן'
    if (/update|edit|move|reschedule/.test(action)) return 'מעדכן אירוע ביומן'
    if (/delete|remove|cancel/.test(action)) return 'מסיר אירוע מהיומן'
    return 'בודק אירועים ביומן'
  }
  if (/gmail|email|mail/.test(normalized)) {
    if (/send/.test(action)) return 'שולח אימייל'
    if (/draft|compose|create/.test(action)) return 'מכין טיוטת אימייל'
    if (/search|list|find|query/.test(action)) return 'מחפש הודעות ב־Gmail'
    if (/read|get|open/.test(action)) return 'קורא הודעה ב־Gmail'
    return 'בודק את Gmail'
  }
  if (/drive|docs|sheets/.test(normalized)) {
    if (/search|list|find/.test(action)) return 'מחפש מסמכים ב־Google Drive'
    if (/write|create|update|edit/.test(action)) return 'מעדכן מסמך ב־Google Drive'
    return 'קורא מסמך מ־Google Drive'
  }
  if (/web_search|search_web/.test(normalized)) return 'מחפש מידע באינטרנט'
  if (/web_extract|fetch|scrape/.test(normalized)) return 'קורא מקור מהאינטרנט'
  if (/browser|computer|screenshot|click|navigate/.test(normalized)) {
    if (/screenshot|capture/.test(action)) return 'מצלם את המסך לבדיקה'
    if (/click|press|select/.test(action)) return 'מפעיל פקד בממשק'
    if (/type|fill|input/.test(action)) return 'ממלא פרטים בממשק'
    if (/open|navigate|goto/.test(action)) return 'פותח עמוד בדפדפן'
    return 'בודק את הממשק בדפדפן'
  }
  if (/terminal|shell|process|command/.test(normalized)) return terminalActivity(command)
  if (/cron|schedule/.test(normalized)) return 'מעדכן משימה מתוזמנת'
  if (/skill/.test(normalized)) return 'מפעיל תהליך עבודה שמור'
  if (/memory/.test(normalized)) return 'בודק פרטים מהזיכרון'
  if (/todo|task/.test(normalized)) return 'מעדכן את רשימת המשימות'
  if (/read.*file|file.*read/.test(normalized)) return 'קורא קובץ מהמחשב'
  if (/write.*file|edit.*file|file.*write/.test(normalized)) return 'מעדכן קובץ במחשב'
  const readable = readableToolName(name)
  return readable ? `מפעיל כלי: ${readable}` : 'מפעיל כלי עזר למשימה'
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
  if (/^every\s+/i.test(schedule)) return schedule.replace(/^every\s+/i, 'כל ')
  return humanizeSchedule(schedule)
}

export function redactDiagnosticText(text: string): string {
  return text
    .replace(/([?&](?:token|ticket)=)[^&\s]+/gi, '$1<redacted>')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|\d{7,}:[A-Za-z0-9_-]{20,})\b/g, '<redacted>')
    .replace(/("(?:api_key|token|secret|password)"\s*:\s*")[^"]+(")/gi, '$1<redacted>$2')
}
