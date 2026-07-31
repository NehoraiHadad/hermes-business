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
})
