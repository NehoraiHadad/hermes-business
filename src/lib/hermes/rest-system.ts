import type { ApiFn } from './core'

export type HermesUpdateStatus = {
  install_method?: string
  current_version?: string
  behind?: number | null
  update_available?: boolean
  can_apply?: boolean
  message?: string | null
  backup_path?: string
}

export type StartUpdateResult = {
  ok?: boolean
  message?: string
  completed?: boolean
  backupPath?: string
}

export interface HermesSystemApi {
  healthCheck(): Promise<{ health: { ok?: boolean }; status: Record<string, unknown> }>
  checkUpdate(force?: boolean): Promise<HermesUpdateStatus>
  startUpdate(): Promise<StartUpdateResult>
  updateActionStatus(): Promise<{ running?: boolean; exit_code?: number | null }>
}

// Health and the Hermes self-update flow. `applyDesktopUpdate`, when present,
// routes the update through the desktop bridge (git/managed preflight +
// rollback); otherwise it falls back to the REST update endpoint.
export function createSystemApi(
  api: ApiFn,
  applyDesktopUpdate?: () => Promise<StartUpdateResult>
): HermesSystemApi {
  return {
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
      if (applyDesktopUpdate) return applyDesktopUpdate()
      return api<StartUpdateResult>('/api/hermes/update', { method: 'POST' })
    },

    updateActionStatus() {
      return api<{ running?: boolean; exit_code?: number | null }>('/api/actions/hermes-update/status?lines=20')
    }
  }
}
