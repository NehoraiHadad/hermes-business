import type { GatewayEvent } from '../../types'
import { createDemoApi } from './demo-api'
import { createDemoDesktop } from './demo-desktop'
import { createDemoRpc } from './demo-rpc'
import type { DemoScenarioId } from './demo-scenarios'
import type { HermesDesktopApi } from './desktop'

export type DemoEmit = (event: GatewayEvent) => void

export type DemoState = {
  activeSession: string
  // Which scripted scenario is waiting on an approval answer, so the demo can
  // follow through on approve/deny instead of going silent.
  pendingApproval: DemoScenarioId | null
}

export type DemoBackend = {
  rpc<T>(method: string, params: Record<string, unknown>, emit: DemoEmit): Promise<T>
  api<T>(endpoint: string, init?: { method?: string; body?: unknown }): Promise<T>
  desktop: HermesDesktopApi
}

// Offline stand-in for Hermes. Its public surface mirrors the real transport plus the
// Electron desktop bridge, while RPC timing, REST fixtures and main-process fixtures
// live in separate modules. This file stays the SOLE entry into the demo subtree —
// stripDemoFixtures replaces it wholesale in a non-demo build, so every fixture module
// it reaches is tree-shaken out of the shipping executable.
export function createDemoBackend(): DemoBackend {
  const state: DemoState = { activeSession: 'weekly-leads', pendingApproval: null }
  return {
    rpc: createDemoRpc(state),
    api: createDemoApi(),
    desktop: createDemoDesktop()
  }
}
