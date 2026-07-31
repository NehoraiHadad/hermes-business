import { describe, expect, it } from 'vitest'
import { buildCron } from './schedule'

describe('task schedule cron builder', () => {
  it('maps weekday tasks to a Sunday–Thursday cron expression', () => {
    expect(buildCron('weekdays', '08:00')).toBe('00 08 * * 0-4')
  })

  it('maps daily tasks to an every-day cron expression', () => {
    expect(buildCron('daily', '23:59')).toBe('59 23 * * *')
  })
})
