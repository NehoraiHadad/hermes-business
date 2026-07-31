import type { GatewayEvent } from '../../types'
import { createDemoApi } from './demo-api'
import { createDemoRpc } from './demo-rpc'

export type DemoEmit = (event: GatewayEvent) => void

export type DemoState = {
  activeSession: string
}

export type DemoBackend = {
  rpc<T>(method: string, params: Record<string, unknown>, emit: DemoEmit): Promise<T>
  api<T>(endpoint: string, init?: { method?: string; body?: unknown }): Promise<T>
}

// Offline stand-in for Hermes. Its public surface mirrors the real transport,
// while RPC timing and REST fixtures live in separate modules.
export function createDemoBackend(): DemoBackend {
  const state: DemoState = { activeSession: 'weekly-leads' }
  return {
    rpc: createDemoRpc(state),
    api: createDemoApi()
  }
}
