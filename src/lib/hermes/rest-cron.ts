import type { ScheduledTask } from '../../types'
import { normalizeScheduledTask } from '../hermes-shapes'
import { withProfile, type ApiFn } from './core'

// Fields a scheduled task's edit form may change. Toggling enabled stays on the
// dedicated pause/resume endpoints, so it is intentionally excluded here.
export type TaskEdit = Partial<Pick<ScheduledTask, 'name' | 'prompt' | 'schedule' | 'deliver'>>

export interface HermesCronApi {
  listTasks(): Promise<ScheduledTask[]>
  createTask(task: Pick<ScheduledTask, 'name' | 'prompt' | 'schedule'>): Promise<unknown>
  toggleTask(task: ScheduledTask): Promise<unknown>
  editTask(id: string, updates: TaskEdit): Promise<unknown>
  triggerTask(id: string): Promise<unknown>
  deleteTask(id: string): Promise<unknown>
}

// Cron / scheduled-task endpoints. All routed through the injected `api` so the
// demo and desktop transports stay interchangeable.
export function createCronApi(api: ApiFn): HermesCronApi {
  return {
    async listTasks() {
      const result = await api<{ jobs?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>(
        withProfile('/api/cron/jobs')
      )
      const jobs = Array.isArray(result) ? result : result.jobs || []
      return jobs.map(normalizeScheduledTask)
    },

    createTask(task) {
      return api(withProfile('/api/cron/jobs'), {
        method: 'POST',
        body: { ...task, deliver: 'local' }
      })
    },

    toggleTask(task) {
      const action = task.enabled ? 'pause' : 'resume'
      return api(withProfile(`/api/cron/jobs/${encodeURIComponent(task.id)}/${action}`), {
        method: 'POST'
      })
    },

    // Atomic partial edit: send only the changed fields as `{updates}` (exact
    // CronJobUpdate contract) in a single PUT, so an edit never risks clobbering
    // fields the form did not touch.
    editTask(id, updates) {
      const cleaned = Object.fromEntries(
        Object.entries(updates).filter(([, value]) => value !== undefined)
      )
      return api(withProfile(`/api/cron/jobs/${encodeURIComponent(id)}`), {
        method: 'PUT',
        body: { updates: cleaned }
      })
    },

    triggerTask(id) {
      return api(withProfile(`/api/cron/jobs/${encodeURIComponent(id)}/trigger`), { method: 'POST' })
    },

    deleteTask(id) {
      return api(withProfile(`/api/cron/jobs/${encodeURIComponent(id)}`), { method: 'DELETE' })
    }
  }
}
