import { describe, expect, it } from 'vitest'
import {
  compileSchedule,
  describeSchedule,
  humanizeSchedule,
  ISRAELI_WORK_WEEK,
  parseSchedule,
  scheduleDefault,
  type FriendlySchedule
} from './schedule'

describe('compileSchedule — friendly model → Hermes schedule string', () => {
  it('compiles daily to an every-day cron expression', () => {
    expect(compileSchedule({ mode: 'daily', time: '23:59' })).toBe('59 23 * * *')
  })

  it('compiles the Israeli work week (Sun–Thu) to a 0-4 cron range', () => {
    expect(compileSchedule({ mode: 'weekly', days: [...ISRAELI_WORK_WEEK], time: '08:00' })).toBe('0 8 * * 0-4')
  })

  it('compiles arbitrary selected weekdays, compressing contiguous runs', () => {
    expect(compileSchedule({ mode: 'weekly', days: [0, 3], time: '09:30' })).toBe('30 9 * * 0,3')
    expect(compileSchedule({ mode: 'weekly', days: [1, 2, 3], time: '09:00' })).toBe('0 9 * * 1-3')
  })

  it('compiles a one-time task to a Hermes ISO timestamp (kind:once)', () => {
    expect(compileSchedule({ mode: 'once', date: '2026-08-05', time: '09:00' })).toBe('2026-08-05T09:00')
  })

  it('passes the advanced escape hatch through verbatim (full Hermes power)', () => {
    expect(compileSchedule({ mode: 'advanced', expr: 'every 30m' })).toBe('every 30m')
  })

  it('refuses to emit a NaN cron or a broken one-shot when time/date is missing/invalid', () => {
    expect(compileSchedule({ mode: 'daily', time: '' })).toBe('')
    expect(compileSchedule({ mode: 'daily', time: '25:00' })).toBe('')
    expect(compileSchedule({ mode: 'weekly', days: [0, 1], time: 'ab:cd' })).toBe('')
    expect(compileSchedule({ mode: 'once', date: '', time: '09:00' })).toBe('')
    expect(compileSchedule({ mode: 'once', date: '2026-08-05', time: '' })).toBe('')
  })
})

describe('parseSchedule — Hermes schedule string → friendly model (round-trip)', () => {
  const roundtrips: FriendlySchedule[] = [
    { mode: 'daily', time: '07:05' },
    { mode: 'weekly', days: [0, 1, 2, 3, 4], time: '08:00' },
    { mode: 'weekly', days: [0, 3], time: '09:30' },
    { mode: 'once', date: '2026-08-05', time: '09:00' }
  ]
  it('is a stable round-trip for every common mode', () => {
    for (const model of roundtrips) {
      expect(parseSchedule(compileSchedule(model))).toEqual(model)
    }
  })

  it('parses a legacy cron expression back into the daily model', () => {
    expect(parseSchedule('0 9 * * *')).toEqual({ mode: 'daily', time: '09:00' })
  })

  it('falls back to the advanced escape hatch for interval / unrecognised forms', () => {
    expect(parseSchedule('every 30m')).toEqual({ mode: 'advanced', expr: 'every 30m' })
    expect(parseSchedule('*/15 * * * *')).toEqual({ mode: 'advanced', expr: '*/15 * * * *' })
  })

  it('preserves an offset-bearing / seconds-bearing one-shot VERBATIM (never drops or shifts it)', () => {
    // With an explicit offset — reinterpreting as local would shift the instant.
    expect(parseSchedule('2026-08-05T09:00:00+03:00')).toEqual({ mode: 'advanced', expr: '2026-08-05T09:00:00+03:00' })
    // With a Z (UTC) suffix.
    expect(parseSchedule('2026-08-05T09:00:00Z')).toEqual({ mode: 'advanced', expr: '2026-08-05T09:00:00Z' })
    // With seconds but no offset — still not the simple friendly form; keep the seconds.
    expect(parseSchedule('2026-08-05T09:00:30')).toEqual({ mode: 'advanced', expr: '2026-08-05T09:00:30' })
  })
})

describe('describeSchedule / humanizeSchedule — human Hebrew display', () => {
  it('names the Israeli work week', () => {
    expect(describeSchedule({ mode: 'weekly', days: [...ISRAELI_WORK_WEEK], time: '08:00' })).toBe('ימים א׳–ה׳ בשעה 08:00')
  })

  it('describes daily and one-time schedules', () => {
    expect(describeSchedule({ mode: 'daily', time: '09:00' })).toBe('כל יום בשעה 09:00')
    expect(describeSchedule({ mode: 'once', date: '2026-08-05', time: '09:00' })).toBe('פעם אחת ב־05/08/2026 בשעה 09:00')
  })

  it('humanizes a raw stored cron string end-to-end', () => {
    expect(humanizeSchedule('0 8 * * 0-4')).toBe('ימים א׳–ה׳ בשעה 08:00')
    expect(humanizeSchedule('0 16 * * 4')).toBe('ימים ה׳ בשעה 16:00')
  })
})

describe('scheduleDefault — mode-switch behaviour keeps the chosen time', () => {
  it('defaults weekly to the Israeli work week and preserves the time', () => {
    expect(scheduleDefault('weekly', '10:15')).toEqual({ mode: 'weekly', days: [0, 1, 2, 3, 4], time: '10:15' })
  })

  it('resets to a blank-date one-time and an empty advanced expression', () => {
    expect(scheduleDefault('once', '10:15')).toEqual({ mode: 'once', date: '', time: '10:15' })
    expect(scheduleDefault('advanced', '10:15')).toEqual({ mode: 'advanced', expr: '' })
  })
})
