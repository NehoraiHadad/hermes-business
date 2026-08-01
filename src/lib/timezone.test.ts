import { describe, expect, it, vi } from 'vitest'
import {
  classifyOneShot,
  describeScheduleTimezone,
  initialConfigTimezone,
  oneShotDstWarning,
  PRODUCT_DEFAULT_TIMEZONE,
  resolveScheduleTimezone
} from './timezone'

describe('resolveScheduleTimezone — Hermes zone, else real system zone, else unknown', () => {
  it('uses the Hermes-configured IANA zone when present', () => {
    expect(resolveScheduleTimezone('America/New_York')).toEqual({ tz: 'America/New_York', source: 'hermes' })
  })

  it('resolves the ACTUAL machine IANA zone (never Jerusalem) when Hermes has none', () => {
    const sys = Intl.DateTimeFormat().resolvedOptions().timeZone
    for (const blank of [null, undefined, '', '   ', 'Not/AZone', 42]) {
      expect(resolveScheduleTimezone(blank)).toEqual({ tz: sys, source: 'system' })
    }
  })

  it('reports unknown (never invents a zone) when the system zone cannot be resolved', () => {
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('no tz')
    })
    try {
      expect(resolveScheduleTimezone('')).toEqual({ tz: '', source: 'unknown' })
    } finally {
      spy.mockRestore()
    }
  })

  it('offers Asia/Jerusalem ONLY as an explicitly-labelled initial-config default', () => {
    expect(initialConfigTimezone()).toEqual({ tz: PRODUCT_DEFAULT_TIMEZONE, source: 'product-default' })
  })

  it('labels every source honestly in the nontechnical UI', () => {
    expect(describeScheduleTimezone({ tz: 'Europe/Berlin', source: 'hermes' })).toContain('מוגדר ב־Hermes')
    expect(describeScheduleTimezone({ tz: 'Europe/Berlin', source: 'system' })).toContain('המחשב')
    expect(describeScheduleTimezone({ tz: PRODUCT_DEFAULT_TIMEZONE, source: 'product-default' })).toContain('ברירת מחדל')
    expect(describeScheduleTimezone({ tz: '', source: 'unknown' })).toContain('אינו ידוע')
  })
})

describe('classifyOneShot — honest DST handling for Asia/Jerusalem', () => {
  // Israel 2026: DST begins Fri 27 Mar 2026, clocks jump 02:00 → 03:00 (02:00–02:59 gap);
  // DST ends Sun 25 Oct 2026, clocks fall 02:00 → 01:00 (01:00–01:59 occurs twice).
  it('flags a spring-forward gap time as nonexistent', () => {
    expect(classifyOneShot('2026-03-27', '02:30', PRODUCT_DEFAULT_TIMEZONE)).toBe('nonexistent')
    expect(oneShotDstWarning('2026-03-27', '02:30', PRODUCT_DEFAULT_TIMEZONE)).toMatch(/אינה קיימת/)
  })

  it('flags a fall-back overlap time as ambiguous', () => {
    expect(classifyOneShot('2026-10-25', '01:30', PRODUCT_DEFAULT_TIMEZONE)).toBe('ambiguous')
    expect(oneShotDstWarning('2026-10-25', '01:30', PRODUCT_DEFAULT_TIMEZONE)).toMatch(/פעמיים/)
  })

  it('treats an ordinary time as valid (no warning)', () => {
    expect(classifyOneShot('2026-08-05', '09:00', PRODUCT_DEFAULT_TIMEZONE)).toBe('valid')
    expect(oneShotDstWarning('2026-08-05', '09:00', PRODUCT_DEFAULT_TIMEZONE)).toBeNull()
  })

  it('returns unknown (no false warning) for malformed input or zone', () => {
    expect(classifyOneShot('bad', '09:00', PRODUCT_DEFAULT_TIMEZONE)).toBe('unknown')
    expect(classifyOneShot('2026-08-05', '9:0', PRODUCT_DEFAULT_TIMEZONE)).toBe('unknown')
    expect(classifyOneShot('2026-08-05', '09:00', 'Not/AZone')).toBe('unknown')
    expect(classifyOneShot('2026-08-05', '09:00', '')).toBe('unknown')
    expect(oneShotDstWarning('bad', '09:00', PRODUCT_DEFAULT_TIMEZONE)).toBeNull()
  })
})
