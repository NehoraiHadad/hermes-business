import type { GatewayEvent } from '../types'
import type { ServerStateSlice } from './server-state'

// Routing table for Hermes 0.19.1's official change-event vocabulary
// (docs/specs/live-refresh.md §3.3/§5.1). This is the single source of truth:
// server-state-wiring.ts (phase 3) drives invalidate() purely off this map, and
// the lockstep test below pins it against both the documented vocabulary and
// the chat-event vocabulary so the two never silently overlap.
//
// pairing.changed / pet.changed / skin.changed ARE part of that broadcast
// vocabulary but have no תכל'ס consumer today (§3.4) — they are listed with an
// empty slice list so "no consumer" reads as a deliberate decision, not a gap.
export const CHANGE_EVENT_SLICES: Record<string, ServerStateSlice[]> = {
  'sessions.changed': ['sessions'],
  'cron.changed': ['schedule', 'partner'],
  'platforms.changed': ['connections'],
  'pairing.changed': [],
  'pet.changed': [],
  'skin.changed': []
}

// Pure and total: routes a gateway event to the server-state slices it should
// invalidate. Never throws — an event type this build doesn't know about
// (a future Hermes backend, or gateway.ready/session/tool events that belong
// to the chat layer, not this one) simply invalidates nothing. A future
// backend broadcasting a new *.changed event must never crash the renderer.
export function routeChangeEvent(event: GatewayEvent): ServerStateSlice[] {
  // Defensive copy: CHANGE_EVENT_SLICES is the single source of truth and must
  // never be mutable via a caller holding onto a previous return value.
  return [...(CHANGE_EVENT_SLICES[event.type] ?? [])]
}

// Extracts payload.change_events from a gateway.ready event (§3.2). Returns
// null for every other event type, so callers can tell "not a gateway.ready"
// apart from "gateway.ready that explicitly said false".
//
// Fail-closed by construction: a gateway.ready whose payload is missing the
// flag, or carries a non-boolean value (older/newer backend), reads as
// `false` — the legacy/backstop cadence, never an assumed `true`.
export function readChangeEventsCapability(event: GatewayEvent): boolean | null {
  if (event.type !== 'gateway.ready') return null
  const value = event.payload?.change_events
  return typeof value === 'boolean' ? value : false
}
