import type { ScheduledTask } from '../types'

export function normalizeScheduledTask(raw: Record<string, unknown>): ScheduledTask {
  const scheduleValue = raw.schedule
  const schedule =
    typeof scheduleValue === 'string'
      ? scheduleValue
      : scheduleValue && typeof scheduleValue === 'object'
        ? String(
            (scheduleValue as Record<string, unknown>).display ||
              (scheduleValue as Record<string, unknown>).expr ||
              ''
          )
        : ''
  return {
    id: String(raw.id || ''),
    name: String(raw.name || ''),
    prompt: String(raw.prompt || ''),
    schedule,
    enabled: Boolean(raw.enabled),
    deliver: typeof raw.deliver === 'string' ? raw.deliver : 'local',
    last_run:
      typeof raw.last_run === 'string'
        ? raw.last_run
        : typeof raw.last_run_at === 'string'
          ? raw.last_run_at
          : null,
    next_run:
      typeof raw.next_run === 'string'
        ? raw.next_run
        : typeof raw.next_run_at === 'string'
          ? raw.next_run_at
          : null
  }
}
