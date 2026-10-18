import type { ComponentType } from 'react'
export type MakomBinding = { origin: string; communitySlug: string; name: string; revision: string; serverName: string }
export type MakomStatus = { profiles: Array<{ id: string; label: string; binding: MakomBinding | null; connected: boolean }> }
export const MakomForm: ComponentType<{
  api: (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>
  onChanged?: (connected: boolean) => void
}>
