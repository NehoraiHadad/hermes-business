import type { ScheduledTask } from '../types'

// Hermes 0.19.1 stores a schedule as one of three kind-objects
// ({kind:'once',run_at,display} | {kind:'cron',expr,display} | {kind:'interval',minutes,display}).
// Collapse it to the exact string our friendly parser round-trips: the once instant
// (run_at, WITH any seconds/offset), the cron expr, or the interval's canonical form —
// never the human `display`, which loses the machine value.
function scheduleToString(scheduleValue: unknown): string {
  if (typeof scheduleValue === 'string') return scheduleValue
  if (!scheduleValue || typeof scheduleValue !== 'object') return ''
  const o = scheduleValue as Record<string, unknown>
  if (o.kind === 'once' && typeof o.run_at === 'string') return o.run_at
  if (o.kind === 'cron' && typeof o.expr === 'string') return o.expr
  if (o.kind === 'interval') {
    if (typeof o.display === 'string' && o.display) return o.display
    if (Number.isFinite(o.minutes)) return `every ${o.minutes}m`
  }
  return String(o.run_at || o.expr || o.display || '')
}

export function normalizeScheduledTask(raw: Record<string, unknown>): ScheduledTask {
  const schedule = scheduleToString(raw.schedule)
  return {
    // Identity: REST/on-disk expose `id`, the cron.manage RPC exposes `job_id`
    // (== the same id). Accept both so a task normalized from either door is
    // first-class and its pause/edit/delete key resolves.
    id: String(raw.id || raw.job_id || ''),
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
