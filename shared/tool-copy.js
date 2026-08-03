// Canonical tool-name/action → Hebrew activity-label rules. src/lib/presentation.ts
// (React app) receives rich agent tool-call payloads (name + action + a command
// buried in various argument shapes) and extracts (name, action, command) itself —
// see toolArguments()/humanizeTool() there — before calling describeTool() below.
// The Rollup-bundled Hermes Desktop plugin's activity strip
// (hermes-plugin/business-shell/src/screens/activity-strip.js) only ever has a bare
// tool NAME off a socket event, so it calls the same describeTool() with no
// action/command and gets the category's honest default text. One rule table either
// way — this used to be TWO: presentation.ts's ~50 action-aware rules and
// helpers.js's own 8-substring TOOL_COPY dict, with no shared code and no test tying
// them together.
//
// describeTool() returns null when nothing matches; each caller supplies its own
// final fallback copy (they differ on purpose — the plugin shows a lightweight
// in-progress ellipsis, the React app shows a labeled generic-tool line).

function terminalActivity(command) {
  const text = String(command || '')
  if (/\b(?:npm|pnpm|yarn|vitest|jest|pytest)\b[^\r\n]*(?:test|check)/i.test(text)) return 'מריץ בדיקות'
  if (/\bgit\s+(?:status|diff|log|show)\b/i.test(text)) return 'בודק את שינויי הקוד'
  if (/\bgit\s+(?:add|commit|push|pull|merge|rebase)\b/i.test(text)) return 'מעדכן את מאגר הקוד'
  if (/\b(?:rg|grep|findstr|select-string)\b/i.test(text)) return 'מחפש בקבצי המחשב'
  if (/\b(?:gmail|google|calendar|drive)\b/i.test(text)) return 'בודק נתוני Google דרך המחשב'
  if (/\b(?:python|python3|py)\b/i.test(text)) return 'מריץ סקריפט Python'
  if (/\b(?:powershell|pwsh)\b/i.test(text)) return 'מריץ פקודת PowerShell'
  return 'מריץ פקודת מערכת'
}

// Ordered category rules. `test` matches the lower-cased tool name; `actions` is an
// ordered list of { test, text } matched against the lower-cased action string
// (first match wins); `fallback` is used when no action rule matches, or when the
// caller has no action at all. The 'terminal' category is special-cased: its
// activity depends on the shell COMMAND, not an action verb.
const CATEGORY_RULES = [
  {
    category: 'calendar',
    test: /google.*calendar|calendar/,
    actions: [
      { test: /create|add|schedule/, text: 'יוצר אירוע ביומן' },
      { test: /update|edit|move|reschedule/, text: 'מעדכן אירוע ביומן' },
      { test: /delete|remove|cancel/, text: 'מסיר אירוע מהיומן' }
    ],
    fallback: 'בודק אירועים ביומן'
  },
  {
    category: 'gmail',
    test: /gmail|email|mail/,
    actions: [
      { test: /send/, text: 'שולח אימייל' },
      { test: /draft|compose|create/, text: 'מכין טיוטת אימייל' },
      { test: /search|list|find|query/, text: 'מחפש הודעות ב־Gmail' },
      { test: /read|get|open/, text: 'קורא הודעה ב־Gmail' }
    ],
    fallback: 'בודק את Gmail'
  },
  {
    category: 'drive',
    test: /drive|docs|sheets/,
    actions: [
      { test: /search|list|find/, text: 'מחפש מסמכים ב־Google Drive' },
      { test: /write|create|update|edit/, text: 'מעדכן מסמך ב־Google Drive' }
    ],
    fallback: 'קורא מסמך מ־Google Drive'
  },
  { category: 'web_search', test: /web_search|search_web/, actions: [], fallback: 'מחפש מידע באינטרנט' },
  { category: 'web_extract', test: /web_extract|fetch|scrape/, actions: [], fallback: 'קורא מקור מהאינטרנט' },
  {
    category: 'browser',
    test: /browser|computer|screenshot|click|navigate/,
    actions: [
      { test: /screenshot|capture/, text: 'מצלם את המסך לבדיקה' },
      { test: /click|press|select/, text: 'מפעיל פקד בממשק' },
      { test: /type|fill|input/, text: 'ממלא פרטים בממשק' },
      { test: /open|navigate|goto/, text: 'פותח עמוד בדפדפן' }
    ],
    fallback: 'בודק את הממשק בדפדפן'
  },
  { category: 'terminal', test: /terminal|shell|process|command/, actions: [], fallback: null },
  { category: 'cron', test: /cron|schedule/, actions: [], fallback: 'מעדכן משימה מתוזמנת' },
  { category: 'skill', test: /skill/, actions: [], fallback: 'מפעיל תהליך עבודה שמור' },
  { category: 'memory', test: /memory/, actions: [], fallback: 'בודק פרטים מהזיכרון' },
  { category: 'todo', test: /todo|task/, actions: [], fallback: 'מעדכן את רשימת המשימות' },
  { category: 'file_read', test: /read.*file|file.*read/, actions: [], fallback: 'קורא קובץ מהמחשב' },
  { category: 'file_write', test: /write.*file|edit.*file|file.*write/, actions: [], fallback: 'מעדכן קובץ במחשב' }
]

// name: the full tool name (any case). action/command are optional finer-grained
// hints a richer caller can supply; omit them (the plugin's activity strip always
// does — it only has a bare name) and you still get the category's honest default.
// Returns null only when NO category matches at all — callers decide their own
// final generic-tool fallback copy.
export function describeTool(name, action = '', command = '') {
  const normalized = String(name || '').toLowerCase()
  const actionText = String(action || '').toLowerCase()
  for (const rule of CATEGORY_RULES) {
    if (!rule.test.test(normalized)) continue
    if (rule.category === 'terminal') return terminalActivity(command)
    const matched = rule.actions.find(entry => entry.test.test(actionText))
    return matched ? matched.text : rule.fallback
  }
  return null
}

// Pinned cross-runtime contract cases, exercised directly against describeTool()
// (no action-defaulting trickery — every case passes an explicit action/command) by
// both src/lib/presentation.test.ts and
// hermes-plugin/business-shell/src/tool-copy.test.js.
export const TOOL_COPY_CASES = [
  { label: 'calendar, no recognised action → category default', name: 'google_calendar.list_events', action: '', command: '', text: 'בודק אירועים ביומן' },
  { label: 'calendar create', name: 'google_calendar', action: 'create', command: '', text: 'יוצר אירוע ביומן' },
  { label: 'calendar delete', name: 'google_calendar', action: 'cancel', command: '', text: 'מסיר אירוע מהיומן' },
  { label: 'gmail send', name: 'gmail.send_message', action: 'send', command: '', text: 'שולח אימייל' },
  { label: 'gmail, no recognised action → category default', name: 'google_workspace.gmail_search', action: '', command: '', text: 'בודק את Gmail' },
  { label: 'drive, no recognised action → category default', name: 'google_drive', action: '', command: '', text: 'קורא מסמך מ־Google Drive' },
  { label: 'drive write', name: 'google_sheets', action: 'update', command: '', text: 'מעדכן מסמך ב־Google Drive' },
  { label: 'web search', name: 'web_search', action: '', command: '', text: 'מחפש מידע באינטרנט' },
  { label: 'web extract', name: 'web_extract', action: '', command: '', text: 'קורא מקור מהאינטרנט' },
  { label: 'browser click', name: 'browser', action: 'click', command: '', text: 'מפעיל פקד בממשק' },
  { label: 'terminal runs tests', name: 'terminal', action: '', command: 'npm test', text: 'מריץ בדיקות' },
  { label: 'terminal git status', name: 'terminal', action: '', command: 'git status', text: 'בודק את שינויי הקוד' },
  { label: 'cron', name: 'cronjob', action: '', command: '', text: 'מעדכן משימה מתוזמנת' },
  { label: 'skill', name: 'skill_manage', action: '', command: '', text: 'מפעיל תהליך עבודה שמור' },
  { label: 'memory', name: 'memory_get', action: '', command: '', text: 'בודק פרטים מהזיכרון' },
  { label: 'todo', name: 'todo_list', action: '', command: '', text: 'מעדכן את רשימת המשימות' },
  { label: 'file read', name: 'read_file', action: '', command: '', text: 'קורא קובץ מהמחשב' },
  { label: 'file write', name: 'write_file', action: '', command: '', text: 'מעדכן קובץ במחשב' },
  { label: 'unrecognised tool → null (caller supplies its own final fallback)', name: 'unknown_internal_tool', action: '', command: '', text: null }
]
