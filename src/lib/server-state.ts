// Module-level "server state" store: freshness/staleness bookkeeping for the
// slices of backend data the renderer shows (sessions, schedule, connections,
// health, partner). Pure — no React import, no hermesClient import. Every
// input (fetchers, timers, connection-state changes, the change_events gate)
// is either injected at construction or fed in by the caller. The wiring that
// actually connects this to hermesClient.onEvent/onConnectionChange lives in
// server-state-wiring.ts (phase 3), which is out of scope here.
//
// Mirrors the official Hermes desktop's live-sync.ts (docs/specs/live-refresh.md
// §3.5/§5.3): trailing-edge coalesced refresh per slice, a single in-flight
// fetch per slice (a change during a fetch queues exactly one more pass, never
// a second concurrent request), fail-closed freshness (a dropped socket marks
// every slice stale immediately; "live"/"degraded" are only ever set after a
// fetch has actually succeeded while the socket was open), a refresh on
// reconnect (reusing the existing chat-resume tracker so "open after a drop"
// isn't reinvented here), a focus-triggered refresh with a minimum gap, and a
// slow backstop poll that is disabled outright while disconnected.

import { createReconnectResumeTracker } from './hermes/chat-resume'
import type { ConnectionState } from './hermes/transport'

export type ServerStateSlice = 'sessions' | 'schedule' | 'connections' | 'health' | 'partner'

const ALL_SLICES: readonly ServerStateSlice[] = ['sessions', 'schedule', 'connections', 'health', 'partner']

// fail-closed: there is no implicit "fresh" state. Fresh = a successful fetch
// while the connection was open. Everything else is honestly unknown or stale.
export type SliceFreshness =
  | { kind: 'unknown' } // never loaded yet
  | { kind: 'live' } // WS open + change_events available
  | { kind: 'degraded' } // WS open, no change_events (backend too old — backstop cadence)
  | { kind: 'stale'; since: number; reason: 'disconnected' | 'load-failed' }

export type SliceStatus = {
  freshness: SliceFreshness
  lastSyncedAt: number | null // Date.now() of the last successful fetch
  refreshing: boolean
}

// Injected clock/timers — same shape and spirit as transport.ts's
// TransportTimers — so tests drive a ManualClock instead of real timers.
export type ServerStateTimers = {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
  now: () => number
}

const DEFAULT_TIMERS: ServerStateTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now()
}

// sessions matches the official SESSIONS_LIST_TICK_GAP_MS; the rest are the
// spec's "others" default.
const DEFAULT_COALESCE_MS: Record<ServerStateSlice, number> = {
  sessions: 10_000,
  schedule: 1_000,
  connections: 1_000,
  health: 1_000,
  partner: 1_000
}

const DEFAULT_FOCUS_MIN_GAP_MS = 15_000
const BACKSTOP_LIVE_MS = 5 * 60_000 // change_events === true, matches the official CRON_BACKSTOP_INTERVAL_MS
const BACKSTOP_DEGRADED_MS = 60_000 // change_events === false — more conservative than the official 30s/10s legacy polls

// Not part of the spec's illustrative deps snippet (§5.3), but required to
// implement rule 7 (demo/bridgeMissing) without this module importing
// hermesClient: the wiring layer (phase 3) reads hermesClient.demo /
// hermesClient.bridgeMissing and picks the mode. 'normal' (default) runs the
// seven rules below; 'demo' is a permanent live with no subscriptions (no
// socket, nothing to fake); 'bridgeMissing' is a permanent stale(disconnected).
export type ServerStateMode = 'normal' | 'demo' | 'bridgeMissing'

export type ServerStateStore = {
  /** A change event routed to this slice arrived — schedules a trailing-edge refresh. */
  invalidate(slice: ServerStateSlice): void
  /** Feed every transport connection-state change here. */
  connectionChanged(state: ConnectionState): void
  /** Feed payload.change_events extracted from a gateway.ready event here. */
  setChangeEvents(available: boolean): void
  /** Manual, serialized refresh of one slice (rule 2 — dedupes against any in-flight fetch). */
  refresh(slice: ServerStateSlice): Promise<void>
  /** Refreshes every slice (used on reconnect, focus, and the backstop timer). */
  refreshAll(): Promise<void>
  /** Focus/visibilitychange entry point — refreshes at most once per focusMinGapMs. */
  refreshOnFocus(): Promise<void>
  getStatus(slice: ServerStateSlice): SliceStatus
  subscribe(slice: ServerStateSlice, listener: (status: SliceStatus) => void): () => void
}

type SliceState = {
  freshness: SliceFreshness
  lastSyncedAt: number | null
  refreshing: boolean
  pendingAgain: boolean
  coalesceTimer: unknown | null
  listeners: Set<(status: SliceStatus) => void>
}

function freshSliceState(): SliceState {
  return {
    freshness: { kind: 'unknown' },
    lastSyncedAt: null,
    refreshing: false,
    pendingAgain: false,
    coalesceTimer: null,
    listeners: new Set()
  }
}

export function createServerStateStore(deps: {
  fetchers: Record<ServerStateSlice, () => Promise<void>>
  timers?: Partial<ServerStateTimers>
  coalesceMs?: Partial<Record<ServerStateSlice, number>>
  focusMinGapMs?: number
  mode?: ServerStateMode
}): ServerStateStore {
  const timers: ServerStateTimers = { ...DEFAULT_TIMERS, ...deps.timers }
  const coalesceMs: Record<ServerStateSlice, number> = { ...DEFAULT_COALESCE_MS, ...deps.coalesceMs }
  const focusMinGapMs = deps.focusMinGapMs ?? DEFAULT_FOCUS_MIN_GAP_MS
  const mode: ServerStateMode = deps.mode ?? 'normal'

  // Reused as-is (not reimplemented): "open that follows a drop" is exactly
  // the reconnect condition useChat already relies on for session.resume.
  const resumeTracker = createReconnectResumeTracker()

  const slices: Record<ServerStateSlice, SliceState> = {
    sessions: freshSliceState(),
    schedule: freshSliceState(),
    connections: freshSliceState(),
    health: freshSliceState(),
    partner: freshSliceState()
  }

  let connectionOpen = false
  let changeEventsAvailable = false
  let backstopTimer: unknown | null = null
  let lastFocusRefreshAt: number | null = null

  if (mode === 'demo') {
    // No socket, nothing to fake — every slice is permanently live.
    for (const slice of ALL_SLICES) slices[slice].freshness = { kind: 'live' }
  } else if (mode === 'bridgeMissing') {
    // No bridge, no data — every slice is permanently, honestly stale.
    const since = timers.now()
    for (const slice of ALL_SLICES) slices[slice].freshness = { kind: 'stale', since, reason: 'disconnected' }
  }

  function getStatus(slice: ServerStateSlice): SliceStatus {
    const state = slices[slice]
    return { freshness: state.freshness, lastSyncedAt: state.lastSyncedAt, refreshing: state.refreshing }
  }

  function notify(slice: ServerStateSlice) {
    const status = getStatus(slice)
    for (const listener of slices[slice].listeners) listener(status)
  }

  function cancelCoalesce(slice: ServerStateSlice) {
    const state = slices[slice]
    if (state.coalesceTimer !== null) {
      timers.clearTimeout(state.coalesceTimer)
      state.coalesceTimer = null
    }
  }

  // Rule 1: trailing-edge coalesce. Every invalidate() resets the per-slice
  // timer, so a burst of change events collapses into exactly one fetch,
  // fired coalesceMs after the LAST event in the burst (the newest write of
  // the burst always lands, never a stale one from mid-burst).
  function invalidate(slice: ServerStateSlice) {
    if (mode !== 'normal') return
    const state = slices[slice]
    cancelCoalesce(slice)
    state.coalesceTimer = timers.setTimeout(() => {
      state.coalesceTimer = null
      void attemptFetch(slice)
    }, coalesceMs[slice])
  }

  // Rule 2: single in-flight fetch per slice. If a fetch is already running
  // when another trigger (coalesce timer, backstop, focus, reconnect, manual
  // refresh) wants to fetch the same slice, it never starts a second,
  // concurrent request — it just marks pendingAgain so runFetch loops once
  // more after the current attempt settles.
  function attemptFetch(slice: ServerStateSlice): Promise<void> {
    const state = slices[slice]
    if (state.refreshing) {
      state.pendingAgain = true
      return Promise.resolve()
    }
    return runFetch(slice)
  }

  async function runFetch(slice: ServerStateSlice): Promise<void> {
    const state = slices[slice]
    state.refreshing = true
    notify(slice)
    try {
      do {
        state.pendingAgain = false
        try {
          await deps.fetchers[slice]()
          state.lastSyncedAt = timers.now()
          // Rule 3: live/degraded are set ONLY after a fetch that succeeded
          // while the connection was open. A fetch that was in flight when
          // the socket dropped, and only resolves afterwards, must not
          // silently flip a disconnected slice back to "fresh".
          if (connectionOpen) {
            state.freshness = changeEventsAvailable ? { kind: 'live' } : { kind: 'degraded' }
          }
        } catch {
          // Rule 3: a failed fetch is honestly stale — but don't let a
          // failure that surfaces after the socket already dropped overwrite
          // the more informative "disconnected" reason with "load-failed".
          state.freshness = {
            kind: 'stale',
            since: timers.now(),
            reason: connectionOpen ? 'load-failed' : 'disconnected'
          }
        }
      } while (state.pendingAgain)
    } finally {
      state.refreshing = false
      notify(slice)
    }
  }

  function refresh(slice: ServerStateSlice): Promise<void> {
    if (mode !== 'normal') return Promise.resolve()
    return attemptFetch(slice)
  }

  function refreshAll(): Promise<void> {
    if (mode !== 'normal') return Promise.resolve()
    return Promise.all(ALL_SLICES.map(slice => refresh(slice))).then(() => undefined)
  }

  function markAllStale(reason: 'disconnected' | 'load-failed') {
    const since = timers.now()
    for (const slice of ALL_SLICES) {
      slices[slice].freshness = { kind: 'stale', since, reason }
      notify(slice)
    }
  }

  function backstopIntervalMs(): number {
    return changeEventsAvailable ? BACKSTOP_LIVE_MS : BACKSTOP_DEGRADED_MS
  }

  function cancelBackstop() {
    if (backstopTimer !== null) {
      timers.clearTimeout(backstopTimer)
      backstopTimer = null
    }
  }

  // Rule 6: one backstop timer for all slices, 5min when change_events is
  // available, 60s (conservative vs. the official 30s/10s — this is not a
  // live TUI) otherwise. Disabled entirely while disconnected: never fire a
  // fetch into a dead connection.
  function scheduleBackstop() {
    cancelBackstop()
    if (mode !== 'normal' || !connectionOpen) return
    backstopTimer = timers.setTimeout(() => {
      backstopTimer = null
      void refreshAll()
      scheduleBackstop()
    }, backstopIntervalMs())
  }

  // Rule 4: only an 'open' that follows a drop triggers refreshAll — never
  // the first open of a fresh boot. Rule 3: closed/reconnecting immediately
  // mark everything stale(disconnected), and reset the change_events gate —
  // only a fresh gateway.ready (setChangeEvents) reseeds it, so a reconnected
  // socket never keeps assuming the fast/live cadence of the connection it
  // just lost.
  function connectionChanged(state: ConnectionState) {
    if (mode !== 'normal') return
    const resumed = resumeTracker.observe(state)
    if (state === 'closed' || state === 'reconnecting') {
      connectionOpen = false
      changeEventsAvailable = false
      cancelBackstop()
      // A coalesce timer scheduled before the drop must not survive it —
      // otherwise it fires a fetch into a connection already marked dead
      // (same never-fetch-while-disconnected principle as the backstop).
      for (const slice of ALL_SLICES) cancelCoalesce(slice)
      markAllStale('disconnected')
      return
    }
    connectionOpen = true
    scheduleBackstop()
    if (resumed) void refreshAll()
  }

  // Rule 4 (continued): a new gateway.ready resets the gate before reseeding
  // it (like the official resetLiveSync) — reschedule the backstop
  // immediately so a capability change takes effect on its own, not only at
  // the next fire.
  function setChangeEvents(available: boolean) {
    if (mode !== 'normal') return
    changeEventsAvailable = available
    if (connectionOpen) scheduleBackstop()
  }

  // Rule 5: refresh on focus, but never more than once per focusMinGapMs, and
  // never while disconnected (there is nothing to refresh — the wiring layer
  // is responsible for waitForConnection-then-refreshAll escalation).
  function refreshOnFocus(): Promise<void> {
    if (mode !== 'normal' || !connectionOpen) return Promise.resolve()
    const now = timers.now()
    if (lastFocusRefreshAt !== null && now - lastFocusRefreshAt < focusMinGapMs) return Promise.resolve()
    lastFocusRefreshAt = now
    return refreshAll()
  }

  function subscribe(slice: ServerStateSlice, listener: (status: SliceStatus) => void): () => void {
    slices[slice].listeners.add(listener)
    return () => {
      slices[slice].listeners.delete(listener)
    }
  }

  return { invalidate, connectionChanged, setChangeEvents, refresh, refreshAll, refreshOnFocus, getStatus, subscribe }
}
