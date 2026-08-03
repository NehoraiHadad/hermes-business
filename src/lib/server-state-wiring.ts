// Thin init module (docs/specs/live-refresh.md §5.4, phase 3): wires the
// renderer's existing hermesClient connection into the module-level
// server-state store. Owns exactly three things, nothing more:
//   1. gateway.ready / *.changed events -> store.setChangeEvents / invalidate
//      (routed through live-refresh.ts's pure vocabulary — this module never
//      inspects event.type itself)
//   2. transport connection state -> store.connectionChanged
//   3. window focus / tab-becomes-visible -> store.refreshOnFocus
//
// Deliberately NOT here: any fetch/data logic beyond the five slice fetchers
// (mirrors the official desktop's `mode` derivation — demo/bridgeMissing are
// read off hermesClient, never hardcoded 'normal').
import type { GatewayEvent } from '../types'
import { hermesClient as defaultHermesClient, type HermesClient } from './hermes-client'
import { loadPartnerState } from './partner'
import { readChangeEventsCapability, routeChangeEvent } from './live-refresh'
import {
  createServerStateStore,
  type ServerStateMode,
  type ServerStateSlice,
  type ServerStateStore,
  type ServerStateTimers
} from './server-state'

export type SliceFetcher = () => Promise<void>
export type SliceFetchers = Record<ServerStateSlice, SliceFetcher>

function modeFromClient(client: Pick<HermesClient, 'demo' | 'bridgeMissing'>): ServerStateMode {
  if (client.demo) return 'demo'
  if (client.bridgeMissing) return 'bridgeMissing'
  return 'normal'
}

// Default per-slice fetchers, used for any slice the caller does not supply
// its own fetcher for. `sessions`/`schedule`/`connections` are normally
// overridden by useHermesData (§5.5 — "the data itself keeps living with the
// owner"); `health` and `partner` have no such owner yet in this phase, so
// their default IS the real implementation (§5.1's health/partner row):
// a fetch whose only purpose today is honest freshness tracking.
//
// Deviation from §5.1's literal `hermesClient.getPartnerState()`: no such
// method exists on the hermesClient facade (checked against
// src/lib/hermes-client.ts) — partner state is read through
// src/lib/partner.ts's `loadPartnerState()`, which is the actual existing
// call site (src/lib/partner.ts:86) and already carries the demo/bridge
// fallback the facade pattern gives every other slice.
function defaultFetchers(client: HermesClient): SliceFetchers {
  return {
    sessions: async () => {
      await client.listSessions()
    },
    schedule: async () => {
      await client.listTasks()
    },
    connections: async () => {
      await Promise.all([client.listMessagingPlatforms(), client.getGoogleStatus()])
    },
    // No `health.changed` event exists (§3.4) — this fetcher only ever runs
    // via reconnect / focus / manual refresh / the backstop timer, never
    // invalidate().
    health: async () => {
      await client.healthCheck()
    },
    // cron.changed also invalidates 'partner' (check-ins live in the same
    // official cron store — see CHANGE_EVENT_SLICES in live-refresh.ts).
    partner: async () => {
      await loadPartnerState()
    }
  }
}

let store: ServerStateStore | null = null
let teardown: Array<() => void> = []

// Idempotent: the FIRST call wins (its fetchers, its client, its timers). A
// second call — StrictMode double-effects, a re-render, a second owner
// mounting — is a safe no-op that returns the existing store untouched. This
// is the only guard that matters: without it, every remount would add a
// second onEvent/onConnectionChange/focus/visibilitychange subscription, and
// every future gateway event would fire the fetchers twice.
export function initServerStateWiring(
  fetchers: Partial<SliceFetchers> = {},
  deps: { client?: HermesClient; timers?: Partial<ServerStateTimers> } = {}
): ServerStateStore {
  if (store) return store

  const client = deps.client ?? defaultHermesClient
  const merged: SliceFetchers = { ...defaultFetchers(client), ...fetchers }
  const created = createServerStateStore({
    fetchers: merged,
    timers: deps.timers,
    mode: modeFromClient(client)
  })
  store = created

  const offEvent = client.onEvent((event: GatewayEvent) => {
    const capability = readChangeEventsCapability(event)
    if (capability !== null) created.setChangeEvents(capability)
    for (const slice of routeChangeEvent(event)) created.invalidate(slice)
  })
  const offConnection = client.onConnectionChange(state => created.connectionChanged(state))

  // §5.3 rule 5, second half: refreshOnFocus() deliberately no-ops while
  // disconnected (nothing to refresh into a dead socket) and delegates the
  // escalation to THIS layer — on a disconnected focus, nudge the transport
  // (bounded wait) and refresh everything only if the connection actually
  // came back. A timeout just leaves the honest stale state on screen.
  const refocus = () => {
    if (client.connectionState === 'open') {
      void created.refreshOnFocus()
      return
    }
    void client
      .waitForConnection({ timeoutMs: 5_000 })
      .then(ok => (ok ? created.refreshAll() : undefined))
      .catch(() => undefined)
  }
  const onFocus = () => {
    refocus()
  }
  // Only the transition TO visible refreshes (§5.4) — hiding the tab is not a
  // signal to fetch anything.
  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') refocus()
  }
  const hasWindow = typeof window !== 'undefined'
  const hasDocument = typeof document !== 'undefined'
  if (hasWindow) window.addEventListener('focus', onFocus)
  if (hasDocument) document.addEventListener('visibilitychange', onVisibility)

  teardown = [
    offEvent,
    offConnection,
    () => {
      if (hasWindow) window.removeEventListener('focus', onFocus)
    },
    () => {
      if (hasDocument) document.removeEventListener('visibilitychange', onVisibility)
    }
  ]

  return created
}

/** The singleton store once initServerStateWiring has run; null before init. */
export function getServerStateStore(): ServerStateStore | null {
  return store
}

// Test-only: undo the wiring so each test starts clean. Never called from
// product code (App.tsx initializes once and never tears down).
export function __resetServerStateWiringForTests(): void {
  for (const off of teardown) off()
  teardown = []
  store = null
}
