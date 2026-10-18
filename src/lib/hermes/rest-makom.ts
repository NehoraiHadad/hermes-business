import type { MakomStatus } from '../../../shared/makom-form.js'
import type { ApiFn } from './core'
export const MAKOM_API = '/api/plugins/business-shell/makom'
export const createMakomApi = (api: ApiFn) => ({
  makomRequest: (path: string, init?: { method?: string; body?: unknown }) => {
    if (!/^\/makom(?:\/(resolve|connect|disconnect))?$/.test(path)) throw Error('Invalid Makom operation')
    return api<unknown>(MAKOM_API + path.slice('/makom'.length), init)
  },
  getMakomStatus: () => api<MakomStatus>(MAKOM_API)
})
export type HermesMakomApi = ReturnType<typeof createMakomApi>
