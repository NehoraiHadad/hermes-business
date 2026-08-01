// Timezone for the nontechnical schedule UI. Hermes anchors a cron/one-shot's naive
// wall-clock to config.yaml["timezone"] (IANA id, or empty = system tz); see the
// 0.19.1 cron scheduler. When Hermes has no zone configured, a BLANK config means the
// system timezone — so we resolve the REAL machine IANA id via Intl (never a silent
// Israeli guess). Asia/Jerusalem is only ever offered as an EXPLICIT product default
// during initial configuration, always with a user-visible label saying so.

// The Israeli product default — used ONLY as an explicitly-labelled initial-config
// choice, never as a silent fallback for an unreadable/blank zone.
export const PRODUCT_DEFAULT_TIMEZONE = 'Asia/Jerusalem'
// Back-compat alias for older imports; prefer PRODUCT_DEFAULT_TIMEZONE.
export const FALLBACK_TIMEZONE = PRODUCT_DEFAULT_TIMEZONE

// hermes         — an explicit IANA id read from Hermes config.yaml.
// system         — config was blank, so we resolved the machine's own IANA zone.
// product-default— the explicit Asia/Jerusalem choice at initial configuration.
// unknown        — config blank AND the system zone could not be resolved: we say so.
export type TimezoneSource = 'hermes' | 'system' | 'product-default' | 'unknown'

export type ResolvedTimezone = { tz: string; source: TimezoneSource }

function isValidIana(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim()) return false
  try {
    // Throws RangeError for an unknown/invalid IANA id.
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

// The machine's own IANA zone, or null when the runtime cannot report a valid one.
function systemTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return isValidIana(tz) ? tz : null
  } catch {
    return null
  }
}

// Resolve the zone a "09:00" schedule means. A configured Hermes zone wins; a blank
// config resolves the system zone; if even that is unavailable we return 'unknown'
// (empty tz) rather than inventing one. Jerusalem is NEVER returned here.
export function resolveScheduleTimezone(configTimezone: unknown): ResolvedTimezone {
  if (isValidIana(configTimezone)) return { tz: configTimezone, source: 'hermes' }
  const sys = systemTimezone()
  if (sys) return { tz: sys, source: 'system' }
  return { tz: '', source: 'unknown' }
}

// The explicit, user-visible product default offered only during initial configuration
// (e.g. a "use Israel time?" choice) — labelled so the owner knows it is a chosen
// default, not a detected fact.
export function initialConfigTimezone(): ResolvedTimezone {
  return { tz: PRODUCT_DEFAULT_TIMEZONE, source: 'product-default' }
}

export function describeScheduleTimezone(resolved: ResolvedTimezone): string {
  switch (resolved.source) {
    case 'hermes':
      return `אזור זמן: ${resolved.tz} (מוגדר ב־Hermes)`
    case 'system':
      return `אזור זמן: ${resolved.tz} (אזור הזמן של המחשב)`
    case 'product-default':
      return `אזור זמן: ${resolved.tz} (ברירת מחדל — ניתן לשנות ב־Hermes)`
    default:
      return 'אזור הזמן אינו ידוע — הגדר אזור זמן ב־Hermes כדי לקבוע מתי משימות ירוצו.'
  }
}

// Offset (minutes east of UTC) that `tz` was at the given UTC instant. Derived from
// Intl so it needs no timezone database of our own and tracks real DST rules.
function tzOffsetMinutes(tz: string, utc: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  const parts = Object.fromEntries(dtf.formatToParts(utc).map(p => [p.type, p.value]))
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  )
  return (asUTC - utc.getTime()) / 60000
}

// Classify a naive one-shot wall-clock against real DST rules for `tz`:
//   valid       — resolves to exactly one instant
//   nonexistent — falls in a spring-forward gap (the clock never shows it)
//   ambiguous   — falls in a fall-back overlap (the clock shows it twice)
//   unknown     — malformed input, or no zone to reason about (never a false warning)
export function classifyOneShot(date: string, time: string, tz: string): 'valid' | 'nonexistent' | 'ambiguous' | 'unknown' {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{2}):(\d{2})$/.exec(time)
  if (!m || !t || !isValidIana(tz)) return 'unknown'
  const [, y, mo, d] = m.map(Number) as unknown as number[]
  const [, hh, mm] = t.map(Number) as unknown as number[]
  const wall = Date.UTC(y, mo - 1, d, hh, mm)
  // Candidate instants using the offset just before and just after the wall time.
  const offBefore = tzOffsetMinutes(tz, new Date(wall - 12 * 60 * 60000))
  const offAfter = tzOffsetMinutes(tz, new Date(wall + 12 * 60 * 60000))
  const instantBefore = wall - offBefore * 60000
  const instantAfter = wall - offAfter * 60000
  const beforeValid = tzOffsetMinutes(tz, new Date(instantBefore)) === offBefore
  const afterValid = tzOffsetMinutes(tz, new Date(instantAfter)) === offAfter
  if (offBefore === offAfter) return 'valid'
  if (!beforeValid && !afterValid) return 'nonexistent'
  if (beforeValid && afterValid && instantBefore !== instantAfter) return 'ambiguous'
  return 'valid'
}

// A Hebrew warning for a DST-hazardous one-shot, or null when the instant is clean.
// An 'unknown' zone yields no warning (we cannot reason) — the UI must instead surface
// that the zone itself is unknown via describeScheduleTimezone.
export function oneShotDstWarning(date: string, time: string, tz: string): string | null {
  const kind = classifyOneShot(date, time, tz)
  if (kind === 'nonexistent') return `בשעון הקיץ של ${tz} השעה הזו אינה קיימת בתאריך שנבחר — בחר שעה אחרת.`
  if (kind === 'ambiguous') return `בשעון החורף של ${tz} השעה הזו מופיעה פעמיים בתאריך שנבחר — ייתכן שהריצה תתבצע בעיתוי הלא צפוי.`
  return null
}
