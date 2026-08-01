// The ONE tested boundary between the simple business UI's nontechnical schedule
// choices and the schedule strings Hermes' official scheduler accepts. Hermes
// (cron/jobs.py parse_schedule) understands three forms we target here:
//   - cron   : a 5-field expression, e.g. "0 9 * * 0-4"
//   - once   : an ISO timestamp, e.g. "2026-08-05T09:00"
//   - interval: "every 30m" (reachable only via the advanced escape hatch)
// The UI never shows raw cron for the common cases; it edits this friendly model,
// compiles it here, and displays describeSchedule() text. We do NOT reimplement a
// scheduler — we only translate to/from Hermes' own forms.

export type FriendlySchedule =
  | { mode: 'daily'; time: string }
  | { mode: 'weekly'; days: number[]; time: string }
  | { mode: 'once'; date: string; time: string }
  | { mode: 'advanced'; expr: string }

// 0=Sunday … 6=Saturday, matching cron's day-of-week numbering (0=Sun).
export const DAY_LABELS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']
// The Israeli work week is Sunday–Thursday.
export const ISRAELI_WORK_WEEK = [0, 1, 2, 3, 4]

function pad(value: string | number): string {
  return String(value).padStart(2, '0')
}

// A wall-clock time is valid only as HH:MM in range — so daily/weekly can never
// compile a NaN cron field (e.g. from a blank or malformed time input).
function isValidTime(time: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(time || '')
  return Boolean(m) && Number(m![1]) <= 23 && Number(m![2]) <= 59
}

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date || '')
}

// A one-shot is "simple" only when it is a bare local wall-clock with NO seconds and
// NO offset/Z. Anything carrying seconds or an offset is a precise instant we must
// NOT reinterpret as local, so it stays in the advanced escape hatch verbatim.
const SIMPLE_ONCE_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/

// Collapse a sorted day list into a compact cron field: contiguous runs become
// ranges (0,1,2,3,4 → "0-4"), the rest stay comma-separated (0,3 → "0,3").
function compressDays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  const parts: string[] = []
  let start = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i <= sorted.length; i += 1) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i]
      continue
    }
    parts.push(start === prev ? `${start}` : start + 1 === prev ? `${start},${prev}` : `${start}-${prev}`)
    start = sorted[i]
    prev = sorted[i]
  }
  return parts.join(',')
}

function expandDays(field: string): number[] {
  const out: number[] = []
  for (const chunk of field.split(',')) {
    const range = chunk.match(/^(\d)-(\d)$/)
    if (range) {
      for (let d = Number(range[1]); d <= Number(range[2]); d += 1) out.push(d % 7)
    } else if (/^\d$/.test(chunk)) {
      out.push(Number(chunk) % 7)
    } else {
      return []
    }
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

// Compile the friendly model to a Hermes schedule string. This is the single place
// UI choices become backend schedule syntax.
export function compileSchedule(model: FriendlySchedule): string {
  if (model.mode === 'advanced') return model.expr.trim()
  // Validate required date/time BEFORE emitting anything, so the caller's
  // `if (!compiled)` guard blocks a save rather than producing a NaN cron or an
  // instant-shifting one-shot. Hermes parses this ISO string into its own once-object.
  if (model.mode === 'once') return isValidDate(model.date) && isValidTime(model.time) ? `${model.date}T${model.time}` : ''
  if (!isValidTime(model.time)) return ''
  const [hour, minute] = model.time.split(':')
  const dow = model.mode === 'weekly' ? compressDays(model.days.length ? model.days : ISRAELI_WORK_WEEK) : '*'
  return `${Number(minute)} ${Number(hour)} * * ${dow}`
}

// Best-effort parse of a stored Hermes schedule string back into the friendly
// model so an existing task can be edited without exposing cron. Anything we do
// not confidently recognise falls back to the advanced escape hatch (never lost).
export function parseSchedule(schedule: string): FriendlySchedule {
  const value = (schedule || '').trim()
  // Only a bare local wall-clock round-trips to the friendly one-shot. A value with
  // seconds or an offset/Z is preserved VERBATIM as advanced so we never drop the
  // seconds/offset or silently shift the instant.
  const simpleOnce = value.match(SIMPLE_ONCE_RE)
  if (simpleOnce) return { mode: 'once', date: simpleOnce[1], time: simpleOnce[2] }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return { mode: 'advanced', expr: value }
  const parts = value.split(/\s+/)
  if (parts.length === 5 && /^\d{1,2}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) {
    const [minute, hour, dom, month, dow] = parts
    const time = `${pad(hour)}:${pad(minute)}`
    if (dom === '*' && month === '*') {
      if (dow === '*') return { mode: 'daily', time }
      const days = expandDays(dow)
      if (days.length) return { mode: 'weekly', days, time }
    }
  }
  return { mode: 'advanced', expr: value }
}

function describeDays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  if (sorted.join(',') === ISRAELI_WORK_WEEK.join(',')) return 'ימים א׳–ה׳'
  if (sorted.join(',') === '0,1,2,3,4,5,6') return 'כל יום'
  return `ימים ${sorted.map(day => DAY_LABELS[day]).join(', ')}`
}

// Human, nontechnical Hebrew description of a friendly model — the only schedule
// text the simple UI ever shows.
export function describeSchedule(model: FriendlySchedule): string {
  if (model.mode === 'daily') return `כל יום בשעה ${model.time}`
  if (model.mode === 'weekly') return `${describeDays(model.days)} בשעה ${model.time}`
  if (model.mode === 'once') {
    const [y, m, d] = model.date.split('-')
    return `פעם אחת ב־${d}/${m}/${y} בשעה ${model.time}`
  }
  return model.expr
}

// Convenience for callers that only hold a raw schedule string (e.g. task rows).
export function humanizeSchedule(schedule: string): string {
  return describeSchedule(parseSchedule(schedule))
}

// The model the picker resets to when the user switches mode, preserving the time
// they already chose. Extracted so the mode-switch behaviour is unit-tested without
// a DOM harness. "weekly" defaults to the Israeli work week (Sun–Thu).
export function scheduleDefault(mode: FriendlySchedule['mode'], time: string): FriendlySchedule {
  if (mode === 'daily') return { mode: 'daily', time }
  if (mode === 'weekly') return { mode: 'weekly', days: [...ISRAELI_WORK_WEEK], time }
  if (mode === 'once') return { mode: 'once', date: '', time }
  return { mode: 'advanced', expr: '' }
}
