import type { ScheduledTask } from '../types'

// Derivation for the home (empty-conversation) "מצב העסק" strip. Pure and
// clock-INJECTED (`nowMs`) so the wording is deterministic under test and
// identical for every card in one render pass — same discipline as
// src/lib/relative-time.ts.
//
// THE INVARIANT THIS FILE EXISTS TO PROTECT: `tasks` is an EMPTY PLACEHOLDER
// whenever the authoritative schedule read failed (useHermesData.fetchSchedule
// swallows the rejection and sets loadErrors.tasks). Counting a placeholder
// produces a confident 0 — a lie. So `loadError` short-circuits to
// activeCount:null / nextRun:null, and every consumer must render null as
// 'לא ידוע', exactly like TasksScreen's stat cards do.

export type HomeTasksSummary = {
  /** Enabled scheduled tasks. null = UNKNOWN (the read failed), never 0. */
  activeCount: number | null
  /** Hebrew wording for the soonest run, or null when unknown/none is scheduled. */
  nextRun: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

// Written out rather than taken from toLocaleDateString('he-IL'): the label must
// not depend on the host's ICU data being complete (packaged Electron, CI node).
const WEEKDAYS = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת']

// Past a week a weekday name stops identifying a day ("יום שלישי" — which one?).
const WEEKDAY_DAYS_LIMIT = 7

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

// Whole LOCAL calendar days ahead — that is what "מחר" means to a reader, and an
// elapsed-hours count gets it wrong around midnight. Comparing local midnights
// instead of dividing by a fixed 24h also keeps DST days correct.
function calendarDaysAhead(atMs: number, nowMs: number): number {
  const at = new Date(atMs)
  const now = new Date(nowMs)
  const atMidnight = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.round((atMidnight - nowMidnight) / DAY_MS)
}

function formatInstant(atMs: number, nowMs: number): string {
  const at = new Date(atMs)
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  const days = calendarDaysAhead(atMs, nowMs)
  if (days === 0) return `היום ${time}`
  if (days === 1) return `מחר ${time}`
  if (days > 1 && days < WEEKDAY_DAYS_LIMIT) return `${WEEKDAYS[at.getDay()]} ${time}`
  return `${pad(at.getDate())}/${pad(at.getMonth() + 1)} ${time}`
}

/**
 * `next_run` reaches us in two shapes: an ISO instant from a real Hermes profile
 * (src/lib/hermes-shapes.ts maps next_run/next_run_at straight through) and an
 * already-human Hebrew phrase from the fixture backend. An unparseable value is
 * therefore passed through untouched rather than discarded — it is somebody
 * else's already-readable wording, not garbage.
 */
export function formatNextRun(raw: string, nowMs: number): string {
  const value = raw.trim()
  if (!value) return ''
  const at = Date.parse(value)
  return Number.isNaN(at) ? value : formatInstant(at, nowMs)
}

export function summarizeHomeTasks(
  tasks: ScheduledTask[],
  loadError: boolean,
  nowMs: number
): HomeTasksSummary {
  // Fail closed: unread is not empty. See the file header.
  if (loadError) return { activeCount: null, nextRun: null }

  const active = tasks.filter(task => task.enabled)
  const scheduled = active
    .map(task => (typeof task.next_run === 'string' ? task.next_run.trim() : ''))
    .filter(Boolean)
  if (!scheduled.length) return { activeCount: active.length, nextRun: null }

  // "הריצה הבאה" must be the SOONEST run, not whichever task the list happened to
  // return first. Only parseable instants can be compared; if none are (fixture
  // wording), fall back to the first value and show it as-is.
  const instants = scheduled.map(value => Date.parse(value)).filter(value => !Number.isNaN(value))
  const nextRun = instants.length
    ? formatInstant(Math.min(...instants), nowMs)
    : formatNextRun(scheduled[0], nowMs)
  return { activeCount: active.length, nextRun: nextRun || null }
}
