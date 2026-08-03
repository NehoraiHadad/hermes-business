// Canonical cron/once → Hebrew DISPLAY core, shared by the React app's friendly
// schedule picker (src/lib/schedule.ts, which additionally owns FORM compilation —
// UI state → cron string — that the plugin never needs) and the Rollup-bundled
// Hermes Desktop plugin (hermes-plugin/business-shell/src/helpers.js), which only
// ever holds a raw stored schedule string (job.schedule_display/schedule/cron).
//
// This module knows nothing about the daily/weekly/once/advanced picker UI state —
// only how to turn a Hermes schedule STRING into Hebrew display text, and the small
// day-list building blocks both sides need. schedule.ts wraps this for its friendly
// model and round-trips describeSchedule() through compileSchedule() + this core so
// the two can never drift apart again (see schedule.ts for that wiring). Before this
// module existed, the plugin's own <select> presets and describeSchedule copy were a
// hand-duplicated 3-entry lookup (hermes-plugin/business-shell/src/helpers.js) that
// only coincidentally matched the React side and silently fell back to raw cron for
// anything else (e.g. a 4th preset, or an arbitrary weekday combination).

// 0=Sunday … 6=Saturday, matching cron's day-of-week numbering (0=Sun).
export const DAY_LABELS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']
// The Israeli work week is Sunday–Thursday.
export const ISRAELI_WORK_WEEK = [0, 1, 2, 3, 4]

// A bare local once-timestamp — NO seconds, NO offset/Z — is the only "simple" once
// form the friendly picker understands. Anything carrying seconds or an offset is a
// precise instant that must never be reinterpreted as local, so callers keep it
// verbatim (see schedule.ts's parseSchedule for the friendly-model side of this).
export const SIMPLE_ONCE_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/

export function pad(value) {
  return String(value).padStart(2, '0')
}

// Collapse a sorted day list into a compact cron field: contiguous runs become
// ranges (0,1,2,3,4 → "0-4"), the rest stay comma-separated (0,3 → "0,3").
export function compressDays(days) {
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  const parts = []
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

// Inverse of compressDays: expand a cron day-of-week field (possibly containing
// ranges and/or a comma list) back into a sorted, deduped day-number array. Returns
// [] for anything it cannot confidently parse, so callers fall back honestly.
export function expandDays(field) {
  const out = []
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

// Human Hebrew phrasing for a day-number list, with the two common cases named
// specially (the Israeli work week, and every day) and day-range compression for
// everything else — e.g. [0,1,2,3,4] → "ימים א׳–ה׳", [0,3] → "ימים א׳, ד׳".
export function describeDays(days) {
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  if (sorted.join(',') === ISRAELI_WORK_WEEK.join(',')) return 'ימים א׳–ה׳'
  if (sorted.join(',') === '0,1,2,3,4,5,6') return 'כל יום'
  return `ימים ${sorted.map(day => DAY_LABELS[day]).join(', ')}`
}

// Turn a raw Hermes schedule string (5-field cron, or a bare local once ISO
// timestamp) into a Hebrew description. Anything not confidently recognised is
// returned TRIMMED but otherwise VERBATIM — never dropped, never "[object
// Object]" — so an already-human display string, an interval expression, an
// offset/seconds-bearing once, or a genuinely unusual cron field all round-trip
// safely instead of throwing away information. An empty/blank input returns ''; the
// caller decides what "no schedule" copy to show (the plugin and the React side use
// different fallback text there).
export function humanizeSchedule(schedule) {
  const value = String(schedule || '').trim()
  if (!value) return ''
  const simpleOnce = value.match(SIMPLE_ONCE_PATTERN)
  if (simpleOnce) {
    const [, date, time] = simpleOnce
    const [y, m, d] = date.split('-')
    return `פעם אחת ב־${d}/${m}/${y} בשעה ${time}`
  }
  const parts = value.split(/\s+/)
  if (parts.length === 5 && /^\d{1,2}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) {
    const [minute, hour, dom, month, dow] = parts
    const time = `${pad(hour)}:${pad(minute)}`
    if (dom === '*' && month === '*') {
      if (dow === '*') return `כל יום בשעה ${time}`
      const days = expandDays(dow)
      if (days.length) return `${describeDays(days)} בשעה ${time}`
    }
  }
  return value
}

// Common quick-create presets. One array — add a fourth preset here and BOTH the
// plugin's <select> (hermes-plugin/business-shell/src/screens/automation-form.js)
// and any future React quick-create surface render it correctly, with the label
// always derived from humanizeSchedule() so it can never drift out of the
// coincidental hand-matched sync that used to require touching two files.
export const SCHEDULE_PRESET_VALUES = ['0 8 * * 0-4', '0 9 * * *', '0 9 * * 0']

// Pinned cross-runtime contract cases. src/lib/schedule.test.ts and
// hermes-plugin/business-shell/src/schedule-display.test.js both run every case
// through their own call path down into this same humanizeSchedule(), so a drift on
// either side fails a focused test instead of silently rendering raw cron.
export const SCHEDULE_DISPLAY_CASES = [
  { label: 'Israeli work week', schedule: '0 8 * * 0-4', text: 'ימים א׳–ה׳ בשעה 08:00' },
  { label: 'every day', schedule: '0 9 * * *', text: 'כל יום בשעה 09:00' },
  { label: 'single weekday (Sunday)', schedule: '0 9 * * 0', text: 'ימים א׳ בשעה 09:00' },
  { label: 'single weekday (Thursday)', schedule: '0 16 * * 4', text: 'ימים ה׳ בשעה 16:00' },
  { label: 'arbitrary day list', schedule: '30 9 * * 0,3', text: 'ימים א׳, ד׳ בשעה 09:30' },
  { label: 'contiguous but non-work-week range (no extra compression beyond the two named sets)', schedule: '0 9 * * 1-3', text: 'ימים ב׳, ג׳, ד׳ בשעה 09:00' },
  { label: 'every day spelled out as 0-6', schedule: '0 7 * * 0-6', text: 'כל יום בשעה 07:00' },
  { label: 'simple local once', schedule: '2026-08-05T09:00', text: 'פעם אחת ב־05/08/2026 בשעה 09:00' },
  { label: 'offset-bearing once falls back verbatim', schedule: '2026-08-05T09:00:00+03:00', text: '2026-08-05T09:00:00+03:00' },
  { label: 'seconds-bearing once falls back verbatim', schedule: '2026-08-05T09:00:30', text: '2026-08-05T09:00:30' },
  { label: 'interval expression falls back verbatim', schedule: 'every 30m', text: 'every 30m' },
  { label: 'already-human text round-trips', schedule: 'כל יום בשעה 09:00', text: 'כל יום בשעה 09:00' },
  { label: 'empty string', schedule: '', text: '' }
]
