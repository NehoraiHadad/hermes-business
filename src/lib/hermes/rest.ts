import type { ScheduledTask, Skill } from '../../types'
import type { HermesMessagingPlatform } from '../connections'
import { normalizeScheduledTask } from '../hermes-shapes'
import { buildSkillContent } from '../skill-content'
import { createProviderApi, type HermesProviderApi } from './providers'

export type HermesUpdateStatus = {
  install_method?: string
  current_version?: string
  behind?: number | null
  update_available?: boolean
  can_apply?: boolean
  message?: string | null
}

export type ApiFn = <T>(endpoint: string, init?: { method?: string; body?: unknown }) => Promise<T>

export interface HermesRest extends HermesProviderApi {
  listTasks(): Promise<ScheduledTask[]>
  createTask(task: Pick<ScheduledTask, 'name' | 'prompt' | 'schedule'>): Promise<unknown>
  toggleTask(task: ScheduledTask): Promise<unknown>
  listSkills(): Promise<Skill[]>
  createSkill(name: string, description: string): Promise<unknown>
  listMessagingPlatforms(): Promise<HermesMessagingPlatform[]>
  testMessagingPlatform(id: string): Promise<{ ok?: boolean; state?: string; message?: string }>
  connectTelegram(token: string, userId: string): Promise<{ ok?: boolean; state?: string; message?: string }>
  healthCheck(): Promise<{ health: { ok?: boolean }; status: Record<string, unknown> }>
  checkUpdate(force?: boolean): Promise<HermesUpdateStatus>
  startUpdate(): Promise<{ ok?: boolean; message?: string }>
  updateActionStatus(): Promise<{ running?: boolean; exit_code?: number | null }>
}

// REST-backed integrations: cron/scheduled tasks, messaging connectors, skills,
// provider setup, health and the Hermes self-update flow. All routed through a
// single injected `api` function so the demo and desktop transports are
// interchangeable.
export function createHermesRest(api: ApiFn): HermesRest {
  const testMessagingPlatform: HermesRest['testMessagingPlatform'] = id =>
    api(`/api/messaging/platforms/${encodeURIComponent(id)}/test?profile=default`, { method: 'POST' })
  const providers = createProviderApi(api)

  return {
    ...providers,
    async listTasks() {
      const result = await api<{ jobs?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>(
        '/api/cron/jobs?profile=default'
      )
      const jobs = Array.isArray(result) ? result : result.jobs || []
      return jobs.map(normalizeScheduledTask)
    },

    createTask(task) {
      return api('/api/cron/jobs?profile=default', {
        method: 'POST',
        body: { ...task, deliver: 'local' }
      })
    },

    toggleTask(task) {
      return api(
        `/api/cron/jobs/${encodeURIComponent(task.id)}/${task.enabled ? 'pause' : 'resume'}?profile=default`,
        { method: 'POST' }
      )
    },

    listSkills() {
      return api<Skill[]>('/api/skills?profile=default')
    },

    createSkill(name, description) {
      const content = buildSkillContent(name, description)
      return api('/api/skills', {
        method: 'POST',
        body: { name, content, category: 'business', profile: 'default' }
      })
    },

    async listMessagingPlatforms() {
      const result = await api<{ platforms?: HermesMessagingPlatform[] }>(
        '/api/messaging/platforms?profile=default'
      )
      return Array.isArray(result.platforms) ? result.platforms : []
    },

    testMessagingPlatform,

    async connectTelegram(token, userId) {
      await api('/api/messaging/platforms/telegram?profile=default', {
        method: 'PUT',
        body: {
          enabled: true,
          env: { TELEGRAM_BOT_TOKEN: token, TELEGRAM_ALLOWED_USERS: userId },
          clear_env: []
        }
      })
      await api('/api/gateway/restart?profile=default', { method: 'POST' })
      let verification: { ok?: boolean; state?: string; message?: string } = {}
      for (let attempt = 0; attempt < 20; attempt += 1) {
        verification = await testMessagingPlatform('telegram')
        if (verification.ok) return verification
        if (['not_configured', 'startup_failed', 'disabled'].includes(String(verification.state))) break
        await new Promise(resolve => window.setTimeout(resolve, 1000))
      }
      throw new Error(
        verification.message ||
          'Hermes שמר את הפרטים, אבל Telegram עדיין לא דיווח על חיבור פעיל. בדוק את ה־token ונסה שוב.'
      )
    },

    async healthCheck() {
      const [health, status] = await Promise.all([
        api<{ ok?: boolean }>('/api/health'),
        api<Record<string, unknown>>('/api/status')
      ])
      return { health, status }
    },

    checkUpdate(force = false) {
      return api<HermesUpdateStatus>(`/api/hermes/update/check?force=${force ? 'true' : 'false'}`)
    },

    startUpdate() {
      return api<{ ok?: boolean; message?: string }>('/api/hermes/update', { method: 'POST' })
    },

    updateActionStatus() {
      return api<{ running?: boolean; exit_code?: number | null }>('/api/actions/hermes-update/status?lines=20')
    }
  }
}
