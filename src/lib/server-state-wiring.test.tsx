// @vitest-environment jsdom
import '../test/setup-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HermesClient } from './hermes-client'
import { HermesTransport } from './hermes/transport'
import { FakeWebSocket, ManualClock } from './hermes/fake-websocket'
import { __resetServerStateWiringForTests, getServerStateStore, initServerStateWiring } from './server-state-wiring'
import type { ServerStateSlice, ServerStateTimers } from './server-state'

// Integration coverage for docs/specs/live-refresh.md §8 point 3 (the
// FakeWebSocket/ManualClock scenario) and the wiring idempotence guard (§5.4).
// Uses jsdom (not node) because this module also wires window 'focus' and
// document 'visibilitychange' — real listener registration/dispatch, not a
// stub, is the point of that half of the coverage.

const WS_URL = 'ws://hermes/dashboard'
const REAL_MODE = { hasBridge: true, explicitDemo: false, isDev: false, demoAllowed: false }
const ALL_SLICES: ServerStateSlice[] = ['sessions', 'schedule', 'connections', 'health', 'partner']

function timersFrom(clock: ManualClock): ServerStateTimers {
  return {
    setTimeout: (fn, ms) => clock.timers.setTimeout(fn, ms),
    clearTimeout: handle => clock.timers.clearTimeout(handle as ReturnType<typeof setTimeout>),
    now: () => clock.timers.now()
  }
}

function countingFetchers() {
  const calls: Record<ServerStateSlice, number> = { sessions: 0, schedule: 0, connections: 0, health: 0, partner: 0 }
  const fetchers = {} as Record<ServerStateSlice, () => Promise<void>>
  for (const slice of ALL_SLICES) {
    fetchers[slice] = async () => {
      calls[slice] += 1
    }
  }
  return { fetchers, calls }
}

function totalCalls(calls: Record<ServerStateSlice, number>): number {
  return ALL_SLICES.reduce((sum, slice) => sum + calls[slice], 0)
}

function deliverEvent(socket: FakeWebSocket, type: string, payload?: Record<string, unknown>) {
  socket.deliver({ jsonrpc: '2.0', method: 'event', params: { type, session_id: '', payload } })
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  __resetServerStateWiringForTests()
  vi.unstubAllGlobals()
})

describe('server-state-wiring integration (§8.3)', () => {
  it('connect -> gateway.ready(change_events:true) -> cron.changed coalesces to one schedule (and partner) fetch; disconnect marks every slice stale; reconnect refreshes once', async () => {
    const clock = new ManualClock()
    const transport = new HermesTransport({ timers: clock.timers, random: () => 0 })
    const client = new HermesClient({ transport, mode: REAL_MODE })
    const { fetchers, calls } = countingFetchers()

    const store = initServerStateWiring(fetchers, { client, timers: timersFrom(clock) })
    expect(getServerStateStore()).toBe(store)

    const opened = client.connect(WS_URL)
    FakeWebSocket.instances.at(-1)!.open()
    await opened

    const socket = FakeWebSocket.instances.at(-1)!
    deliverEvent(socket, 'gateway.ready', { change_events: true })
    deliverEvent(socket, 'cron.changed')

    // default coalesceMs.schedule = 1_000; a second cron.changed mid-window
    // must not double-fire, only reset the trailing edge.
    await clock.advance(500)
    deliverEvent(socket, 'cron.changed')
    expect(calls.schedule).toBe(0)
    expect(calls.partner).toBe(0)

    await clock.advance(999)
    expect(calls.schedule).toBe(0) // still mid the RESET window

    await clock.advance(1)
    expect(calls.schedule).toBe(1) // exactly once
    expect(calls.partner).toBe(1) // cron.changed routes to schedule AND partner (§5.1)
    expect(calls.sessions).toBe(0)
    expect(calls.connections).toBe(0)

    // Disconnect: every slice goes stale(disconnected) immediately.
    socket.close()
    for (const slice of ALL_SLICES) {
      expect(store.getStatus(slice).freshness).toMatchObject({ kind: 'stale', reason: 'disconnected' })
    }

    // Reconnect (open-after-drop): refreshAll runs exactly once — every slice's
    // call count goes up by exactly one from wherever it stood pre-disconnect
    // (schedule/partner were already at 1 from the coalesced cron.changed).
    const beforeReconnect = { ...calls }
    await clock.advance(500)
    FakeWebSocket.instances.at(-1)!.open()
    await ManualClock.flush()

    for (const slice of ALL_SLICES) expect(calls[slice]).toBe(beforeReconnect[slice] + 1)
  })

  it('routes window focus into refreshOnFocus, and a visibilitychange only when the tab is actually visible', async () => {
    const clock = new ManualClock()
    const transport = new HermesTransport({ timers: clock.timers, random: () => 0 })
    const client = new HermesClient({ transport, mode: REAL_MODE })
    const { fetchers, calls } = countingFetchers()

    initServerStateWiring(fetchers, { client, timers: timersFrom(clock) })

    const opened = client.connect(WS_URL)
    FakeWebSocket.instances.at(-1)!.open()
    await opened

    window.dispatchEvent(new Event('focus'))
    await ManualClock.flush()
    expect(totalCalls(calls)).toBe(ALL_SLICES.length)

    // Hidden tab: visibilitychange fires, but the visible-only gate must
    // swallow it regardless of focusMinGapMs.
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await ManualClock.flush()
    expect(totalCalls(calls)).toBe(ALL_SLICES.length) // unchanged

    // Past the default 15s focusMinGapMs AND now visible: this time it refreshes.
    await clock.advance(15_000)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await ManualClock.flush()
    expect(totalCalls(calls)).toBe(ALL_SLICES.length * 2)
  })

  it('a focus while DISCONNECTED escalates: bounded waitForConnection, then refreshAll only if the socket came back', async () => {
    const clock = new ManualClock()
    const transport = new HermesTransport({ timers: clock.timers, random: () => 0 })
    const client = new HermesClient({ transport, mode: REAL_MODE })
    const { fetchers, calls } = countingFetchers()

    initServerStateWiring(fetchers, { client, timers: timersFrom(clock) })

    const opened = client.connect(WS_URL)
    FakeWebSocket.instances.at(-1)!.open()
    await opened

    // Drop the socket, then refocus while disconnected. refreshOnFocus alone
    // would no-op (§5.3 rule 5) — the wiring must instead nudge the transport
    // and refresh everything once the reconnect lands within the bounded wait.
    FakeWebSocket.instances.at(-1)!.close()
    window.dispatchEvent(new Event('focus'))
    expect(totalCalls(calls)).toBe(0) // nothing fetched into a dead connection

    await clock.advance(500) // transport backoff -> reconnect attempt
    FakeWebSocket.instances.at(-1)!.open()
    await ManualClock.flush()
    // Reconnect-resume already refreshes all slices once (rule 4); the focus
    // escalation's waitForConnection resolving adds at most one more pass —
    // never zero (the point of this test) and never a storm.
    expect(calls.schedule).toBeGreaterThanOrEqual(1)
    expect(calls.schedule).toBeLessThanOrEqual(2)

    // A disconnected focus whose bounded wait EXPIRES refreshes nothing.
    FakeWebSocket.instances.at(-1)!.close()
    const before = totalCalls(calls)
    window.dispatchEvent(new Event('focus'))
    await clock.advance(6_000) // past the 5s waitForConnection deadline, no reconnect
    await ManualClock.flush()
    expect(totalCalls(calls)).toBe(before)
  })
})

describe('idempotence', () => {
  it('a second init call is a no-op: same store, no duplicate event subscriptions', async () => {
    const clock = new ManualClock()
    const transport = new HermesTransport({ timers: clock.timers, random: () => 0 })
    const client = new HermesClient({ transport, mode: REAL_MODE })
    const { fetchers: first, calls: firstCalls } = countingFetchers()
    const { fetchers: second, calls: secondCalls } = countingFetchers()

    const store1 = initServerStateWiring(first, { client, timers: timersFrom(clock) })
    const store2 = initServerStateWiring(second, { client, timers: timersFrom(clock) })
    expect(store2).toBe(store1)

    const opened = client.connect(WS_URL)
    FakeWebSocket.instances.at(-1)!.open()
    await opened

    deliverEvent(FakeWebSocket.instances.at(-1)!, 'cron.changed')
    await clock.advance(1_000)

    // The second call's fetchers never won, so they must never be called...
    expect(secondCalls.schedule).toBe(0)
    // ...and the first (winning) fetcher fires exactly once per event, not
    // twice — proving there is only one onEvent subscription, not two.
    expect(firstCalls.schedule).toBe(1)
    expect(store1.getStatus('schedule').lastSyncedAt).not.toBeNull()
  })
})
