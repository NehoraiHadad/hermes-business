import { describe, expect, it } from 'vitest'
import { describeSessionTime } from './relative-time'

// Every instant here is built with the LOCAL Date constructor, so the expectations
// hold on any machine timezone — the helper itself is deterministic because `now` is
// injected rather than read from the clock.
const seconds = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  Math.floor(new Date(year, month - 1, day, hour, minute).getTime() / 1000)
const ms = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).getTime()

const NOW = ms(2026, 8, 13, 10, 0)

describe('describeSessionTime — honest unknown', () => {
  it('never invents a moment for a missing/zero/invalid start time', () => {
    // App.tsx builds a placeholder session with started_at: 0 — that must stay unknown,
    // not become "1 בינואר 1970" and not become a confident "לאחרונה".
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(describeSessionTime(value, NOW)).toEqual({ label: null, exact: null, iso: null })
    }
  })

  it('stays unknown when the timestamp is meaningfully in the future', () => {
    expect(describeSessionTime(seconds(2026, 8, 13, 12, 0), NOW).label).toBeNull()
  })

  it('stays unknown when `now` itself is unusable', () => {
    expect(describeSessionTime(seconds(2026, 8, 13, 9, 0), Number.NaN).label).toBeNull()
  })
})

describe('describeSessionTime — minutes and hours', () => {
  it('reads as "עכשיו" under a minute, including sub-minute clock jitter', () => {
    expect(describeSessionTime(seconds(2026, 8, 13, 10, 0), NOW).label).toBe('עכשיו')
    expect(describeSessionTime(Math.floor((NOW + 30_000) / 1000), NOW).label).toBe('עכשיו')
  })

  it('gets Hebrew number-noun agreement right for 1 and 2 minutes', () => {
    expect(describeSessionTime(seconds(2026, 8, 13, 9, 59), NOW).label).toBe('לפני דקה')
    expect(describeSessionTime(seconds(2026, 8, 13, 9, 58), NOW).label).toBe('לפני שתי דקות')
  })

  it('counts plural minutes up to the hour boundary', () => {
    expect(describeSessionTime(seconds(2026, 8, 13, 9, 55), NOW).label).toBe('לפני 5 דקות')
    expect(describeSessionTime(seconds(2026, 8, 13, 9, 1), NOW).label).toBe('לפני 59 דקות')
  })

  it('gets Hebrew number-noun agreement right for 1 and 2 hours', () => {
    expect(describeSessionTime(seconds(2026, 8, 13, 9, 0), NOW).label).toBe('לפני שעה')
    expect(describeSessionTime(seconds(2026, 8, 13, 8, 0), NOW).label).toBe('לפני שעתיים')
  })

  it('counts plural hours right up to a full day', () => {
    expect(describeSessionTime(seconds(2026, 8, 13, 5, 0), NOW).label).toBe('לפני 5 שעות')
    expect(describeSessionTime(seconds(2026, 8, 12, 11, 0), NOW).label).toBe('לפני 23 שעות')
  })

  it('still says hours — not "אתמול" — for a short gap that merely crossed midnight', () => {
    expect(describeSessionTime(seconds(2026, 8, 12, 23, 0), ms(2026, 8, 13, 1, 0)).label).toBe('לפני שעתיים')
  })
})

describe('describeSessionTime — days', () => {
  it('says "אתמול" only for the previous calendar day', () => {
    expect(describeSessionTime(seconds(2026, 8, 12, 9, 0), NOW).label).toBe('אתמול')
    expect(describeSessionTime(seconds(2026, 8, 12, 22, 0), ms(2026, 8, 13, 23, 0)).label).toBe('אתמול')
  })

  it('does not call two calendar days back "אתמול" even when barely over a day has passed', () => {
    expect(describeSessionTime(seconds(2026, 8, 11, 23, 0), ms(2026, 8, 13, 1, 0)).label).toBe('לפני יומיים')
  })

  it('counts whole days until the weekly cutoff', () => {
    expect(describeSessionTime(seconds(2026, 8, 11, 9, 0), NOW).label).toBe('לפני יומיים')
    expect(describeSessionTime(seconds(2026, 8, 10, 9, 0), NOW).label).toBe('לפני 3 ימים')
    expect(describeSessionTime(seconds(2026, 8, 7, 9, 0), NOW).label).toBe('לפני 6 ימים')
  })

  it('switches to a plain date a week back and beyond', () => {
    expect(describeSessionTime(seconds(2026, 8, 6, 9, 0), NOW).label).toBe('06/08/2026')
    expect(describeSessionTime(seconds(2026, 1, 4, 9, 0), NOW).label).toBe('04/01/2026')
  })
})

describe('describeSessionTime — the exact moment behind the phrase', () => {
  it('carries a readable local moment and a machine-readable instant', () => {
    const at = seconds(2026, 8, 13, 9, 5)
    const described = describeSessionTime(at, NOW)
    expect(described.exact).toBe('13/08/2026 בשעה 09:05')
    expect(described.iso).toBe(new Date(at * 1000).toISOString())
  })

  it('is stable for the same inputs (no hidden clock read)', () => {
    const at = seconds(2026, 8, 13, 9, 5)
    expect(describeSessionTime(at, NOW)).toEqual(describeSessionTime(at, NOW))
  })
})
