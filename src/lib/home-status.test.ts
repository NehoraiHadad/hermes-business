import { describe, expect, it } from 'vitest'
import { formatNextRun, summarizeHomeTasks } from './home-status'
import type { ScheduledTask } from '../types'

// Fixed local clock for every case below: Tue 2026-08-11, 09:30 local time.
const NOW = new Date(2026, 7, 11, 9, 30).getTime()
const at = (day: number, hour: number, minute = 0) => new Date(2026, 7, day, hour, minute).toISOString()

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 't1',
    name: 'סיכום יומי',
    prompt: 'סכם את היום',
    schedule: 'every day 08:00',
    enabled: true,
    ...overrides
  }
}

describe('formatNextRun', () => {
  it('says היום for a run later the same calendar day', () => {
    expect(formatNextRun(at(11, 16, 5), NOW)).toBe('היום 16:05')
  })

  it('says מחר for the next calendar day, even a few hours away', () => {
    expect(formatNextRun(at(12, 8), NOW)).toBe('מחר 08:00')
  })

  it('names the weekday inside the coming week', () => {
    expect(formatNextRun(at(14, 16), NOW)).toBe('יום שישי 16:00')
  })

  it('falls back to a date past a week, where a weekday name identifies nothing', () => {
    expect(formatNextRun(at(20, 7, 45), NOW)).toBe('20/08 07:45')
  })

  it('passes an already-human phrase through untouched instead of discarding it', () => {
    expect(formatNextRun('מחר, 08:00', NOW)).toBe('מחר, 08:00')
  })

  it('treats an empty value as nothing to say', () => {
    expect(formatNextRun('   ', NOW)).toBe('')
  })
})

describe('summarizeHomeTasks', () => {
  it('counts only enabled tasks and picks the SOONEST next run', () => {
    const summary = summarizeHomeTasks(
      [
        task({ id: 'a', next_run: at(14, 16) }),
        task({ id: 'b', next_run: at(12, 8) }),
        task({ id: 'c', enabled: false, next_run: at(11, 10) })
      ],
      false,
      NOW
    )
    expect(summary).toEqual({ activeCount: 2, nextRun: 'מחר 08:00' })
  })

  it('reports a proven-empty schedule as a real 0', () => {
    expect(summarizeHomeTasks([], false, NOW)).toEqual({ activeCount: 0, nextRun: null })
  })

  it('reports no next run when no active task has one', () => {
    expect(summarizeHomeTasks([task({ next_run: null })], false, NOW)).toEqual({
      activeCount: 1,
      nextRun: null
    })
  })

  it('is UNKNOWN — never 0 — when the authoritative read failed', () => {
    // `tasks` is an empty PLACEHOLDER after a failed read, so counting it would
    // manufacture a confident "0 משימות פעילות" out of a failure.
    expect(summarizeHomeTasks([], true, NOW)).toEqual({ activeCount: null, nextRun: null })
  })

  it('stays UNKNOWN on a failed read even if a stale list is still in hand', () => {
    expect(summarizeHomeTasks([task({ next_run: at(12, 8) })], true, NOW)).toEqual({
      activeCount: null,
      nextRun: null
    })
  })
})
