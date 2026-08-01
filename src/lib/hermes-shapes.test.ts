import { describe, expect, it } from 'vitest'
import { normalizeScheduledTask } from './hermes-shapes'

describe('Hermes API shape adapters', () => {
  it('normalizes the current structured cron schedule for the simple UI', () => {
    const task = normalizeScheduledTask({
      id: 'job-1',
      name: 'Morning brief',
      prompt: 'Summarize today',
      schedule: { kind: 'cron', expr: '0 8 * * 0-4', display: '0 8 * * 0-4' },
      enabled: false,
      next_run_at: '2026-08-02T08:00:00+03:00'
    })
    expect(task.schedule).toBe('0 8 * * 0-4')
    expect(task.next_run).toBe('2026-08-02T08:00:00+03:00')
    expect(task.enabled).toBe(false)
  })

  it('preserves the once instant (run_at) — never the lossy human display', () => {
    const task = normalizeScheduledTask({
      id: 'job-once',
      name: 'One-off',
      schedule: { kind: 'once', run_at: '2026-08-05T09:00:00+03:00', display: 'once at 2026-08-05 09:00' },
      enabled: true
    })
    // The machine instant with its offset survives, so the friendly editor never shifts it.
    expect(task.schedule).toBe('2026-08-05T09:00:00+03:00')
  })

  it('reduces an interval object to its canonical advanced string', () => {
    const task = normalizeScheduledTask({
      id: 'job-int',
      name: 'Every 30m',
      schedule: { kind: 'interval', minutes: 30, display: 'every 30m' },
      enabled: true
    })
    expect(task.schedule).toBe('every 30m')
  })
})
