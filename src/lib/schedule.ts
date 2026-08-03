// The ONE tested boundary between the simple business UI's nontechnical schedule
// choices and the schedule strings Hermes' official scheduler accepts. Hermes
// (cron/jobs.py parse_schedule) understands three forms we target here:
//   - cron   : a 5-field expression, e.g. "0 9 * * 0-4"
//   - once   : an ISO timestamp, e.g. "2026-08-05T09:00"
//   - interval: "every 30m" (reachable only via the advanced escape hatch)
// The UI never shows raw cron for the common cases; it edits this friendly model,
// compiles it here, and displays describeSchedule() text. We do NOT reimplement a
// scheduler — we only translate to/from Hermes' own forms.
//
// This file owns FORM COMPILATION ONLY (friendly picker state ⇄ cron/once string).
// The cron/once → Hebrew DISPLAY core (day-list compression/expansion, the human
// wording) lives in ../../shared/schedule-display.js so the Rollup-bundled Hermes
// Desktop plugin (hermes-plugin/business-shell/src/helpers.js) can render the exact
// same fidelity from a raw stored schedule string, without needing this friendly
// model at all. describeSchedule() below round-trips a valid model through
// compileSchedule() and the shared humanizer, so display and compilation can never
// drift apart — see the comment on describeSchedule for the one deliberate
// exception (live-typing preview of an incomplete value).
import {
  DAY_LABELS,
  ISRAELI_WORK_WEEK,
  SIMPLE_ONCE_PATTERN,
  compressDays,
  describeDays,
  expandDays,
  humanizeSchedule as humanizeScheduleString,
  pad
} from '../../shared/schedule-display.js'

export { DAY_LABELS, ISRAELI_WORK_WEEK }

export type FriendlySchedule =
  | { mode: 'daily'; time: string }
  | { mode: 'weekly'; days: number[]; time: string }
  | { mode: 'once'; date: string; time: string }
  | { mode: 'advanced'; expr: string }

// A wall-clock time is valid only as HH:MM in range — so daily/weekly can never
// compile a NaN cron field (e.g. from a blank or malformed time input).
function isValidTime(time: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(time || '')
  return Boolean(m) && Number(m![1]) <= 23 && Number(m![2]) <= 59
}

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date || '')
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
  const simpleOnce = value.match(SIMPLE_ONCE_PATTERN)
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

// Human, nontechnical Hebrew description of a friendly model — the only schedule
// text the simple UI ever shows. For 'advanced' we always echo the raw expression
// back verbatim (the escape hatch shows exactly what the user typed, never a
// reinterpretation). For every other mode we ROUND-TRIP through compileSchedule()
// and the shared cron→Hebrew humanizer — the exact same core the plugin uses — so
// display can never silently drift from what actually gets saved. The one
// deliberate exception: while the user is mid-typing an incomplete time/date,
// compileSchedule() correctly refuses to emit a NaN cron, so we fall back to a
// best-effort direct rendering (still built from the shared describeDays()) rather
// than going blank.
export function describeSchedule(model: FriendlySchedule): string {
  if (model.mode === 'advanced') return model.expr
  const compiled = compileSchedule(model)
  if (compiled) return humanizeScheduleString(compiled)
  if (model.mode === 'once') {
    const [y, m, d] = model.date.split('-')
    return `פעם אחת ב־${d}/${m}/${y} בשעה ${model.time}`
  }
  if (model.mode === 'weekly') return `${describeDays(model.days)} בשעה ${model.time}`
  return `כל יום בשעה ${model.time}`
}

// Convenience for callers that only hold a raw schedule string (e.g. task rows) —
// a thin pass-through to the shared display core.
export function humanizeSchedule(schedule: string): string {
  return humanizeScheduleString(schedule)
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
