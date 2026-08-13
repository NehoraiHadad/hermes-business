// Honest "when was this" wording for the sidebar's recent-conversation rows. Hermes
// hands us `started_at` in epoch SECONDS (the same unit src/lib/partner-feed.ts
// converts for the activity feed), and a row whose timestamp proves nothing must say
// so — never a confident-sounding phrase — exactly like TasksScreen/ConnectionsScreen
// refuse to render a failed read as a healthy value.
//
// `now` is INJECTED (epoch ms) instead of read from the clock in here: the wording is
// then deterministic under test, identical for every row in one render pass, and
// stable between renders so the memoized row component can skip re-rendering.
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

// Past this point a relative phrase stops helping ("לפני 23 ימים" tells nobody
// anything useful), so we show the actual date instead.
const RELATIVE_DAYS_LIMIT = 7

export type SessionTime = {
  /** Hebrew relative wording, or null when the timestamp proves nothing. */
  label: string | null
  /** The exact local moment, for the row's tooltip. null whenever `label` is. */
  exact: string | null
  /** ISO-8601 instant for a machine-readable `<time dateTime>`. null whenever `label` is. */
  iso: string | null
}

const UNKNOWN: SessionTime = { label: null, exact: null, iso: null }

// A usable instant is a finite POSITIVE epoch-seconds value. 0 / NaN / a negative all
// mean "Hermes did not tell us when this started" (App.tsx even builds a placeholder
// session with started_at: 0) — never "1 בינואר 1970".
function toEpochMs(startedAtSeconds: number): number | null {
  if (typeof startedAtSeconds !== 'number' || !Number.isFinite(startedAtSeconds) || startedAtSeconds <= 0) return null
  return startedAtSeconds * 1000
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

// Whole LOCAL calendar days between the two instants — that is what "אתמול" means to
// a reader, and an elapsed-hours count gets it wrong around midnight. Comparing local
// midnights rather than dividing by a fixed 24h also keeps DST days correct.
function calendarDaysBetween(atMs: number, nowMs: number): number {
  const at = new Date(atMs)
  const now = new Date(nowMs)
  const atMidnight = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.round((nowMidnight - atMidnight) / DAY_MS)
}

function formatDate(at: Date): string {
  return `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()}`
}

// Hebrew does not count nouns the way English does: 1 and 2 have their own forms
// (דקה / שתי דקות, שעה / שעתיים, יומיים), and "לפני 1 דקות" reads as broken text.
function relativeLabel(atMs: number, nowMs: number): string | null {
  const elapsed = nowMs - atMs
  // A timestamp in the future is not an age we can state. Under a minute ahead is
  // ordinary clock jitter between Hermes and this window and still reads as "עכשיו";
  // anything further ahead stays honestly unknown instead of being flattened to now.
  if (elapsed < -MINUTE_MS) return null
  if (elapsed < MINUTE_MS) return 'עכשיו'
  if (elapsed < HOUR_MS) {
    const minutes = Math.floor(elapsed / MINUTE_MS)
    if (minutes === 1) return 'לפני דקה'
    if (minutes === 2) return 'לפני שתי דקות'
    return `לפני ${minutes} דקות`
  }
  // Under a day we always say hours: "לפני 3 שעות" is true and more useful than
  // "אתמול" for something that merely crossed midnight.
  if (elapsed < DAY_MS) {
    const hours = Math.floor(elapsed / HOUR_MS)
    if (hours === 1) return 'לפני שעה'
    if (hours === 2) return 'לפני שעתיים'
    return `לפני ${hours} שעות`
  }
  const days = calendarDaysBetween(atMs, nowMs)
  if (days <= 1) return 'אתמול'
  if (days === 2) return 'לפני יומיים'
  if (days < RELATIVE_DAYS_LIMIT) return `לפני ${days} ימים`
  return formatDate(new Date(atMs))
}

// The single entry point a row uses: the relative wording it shows, plus the exact
// moment behind it so the reader can always check what the phrase is based on.
export function describeSessionTime(startedAtSeconds: number, nowMs: number): SessionTime {
  const atMs = toEpochMs(startedAtSeconds)
  if (atMs === null || !Number.isFinite(nowMs)) return UNKNOWN
  const label = relativeLabel(atMs, nowMs)
  if (label === null) return UNKNOWN
  const at = new Date(atMs)
  return {
    label,
    exact: `${formatDate(at)} בשעה ${pad(at.getHours())}:${pad(at.getMinutes())}`,
    iso: at.toISOString()
  }
}
