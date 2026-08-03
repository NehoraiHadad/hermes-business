import { describe, expect, it } from 'vitest'
import { createServerStateStore, type ServerStateSlice, type ServerStateTimers } from './server-state'
import { ManualClock } from './hermes/fake-websocket'

// Rule-by-rule coverage of docs/specs/live-refresh.md §5.3. Every timing test
// injects a ManualClock (the same test double transport.test.ts uses) so the
// coalesce/backstop/focus schedules are asserted exactly, never by sleeping.

const SLICES: ServerStateSlice[] = ['sessions', 'schedule', 'connections', 'health', 'partner']

// Adapts ManualClock's TransportTimers (concrete setTimeout handle type) to
// ServerStateTimers (deliberately `unknown` handles per §5.3) — the two timer
// shapes are structurally close but not directly assignable under
// strictFunctionTypes, so tests bridge them explicitly rather than casting
// the whole store's dependency surface.
function timersFrom(clock: ManualClock): ServerStateTimers {
  return {
    setTimeout: (fn, ms) => clock.timers.setTimeout(fn, ms),
    clearTimeout: handle => clock.timers.clearTimeout(handle as ReturnType<typeof setTimeout>),
    now: () => clock.timers.now()
  }
}

// Every slice gets a trivial resolving fetcher by default (call-counted), with
// per-slice behavior swappable for failure/pending-forever scenarios.
function countingFetchers(behavior: Partial<Record<ServerStateSlice, () => Promise<void>>> = {}) {
  const calls: Record<ServerStateSlice, number> = { sessions: 0, schedule: 0, connections: 0, health: 0, partner: 0 }
  const fetchers = {} as Record<ServerStateSlice, () => Promise<void>>
  for (const slice of SLICES) {
    const impl = behavior[slice]
    fetchers[slice] = async () => {
      calls[slice] += 1
      if (impl) await impl()
    }
  }
  return { fetchers, calls }
}

function totalCalls(calls: Record<ServerStateSlice, number>): number {
  return SLICES.reduce((sum, slice) => sum + calls[slice], 0)
}

// A fetcher that stays pending until the test explicitly resolves it, to
// drive the in-flight/pendingAgain rule deterministically.
function pendingFetcher() {
  const resolvers: Array<() => void> = []
  return {
    fetcher: () => new Promise<void>(resolve => resolvers.push(resolve)),
    resolveNext() {
      const resolve = resolvers.shift()
      if (!resolve) throw new Error('pendingFetcher: no in-flight call to resolve')
      resolve()
    }
  }
}

// Drains real microtasks/macrotasks (mirrors ManualClock.flush()) for the one
// test below that runs on real timers instead of the ManualClock.
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

describe('rule 1: trailing-edge coalesce per slice', () => {
  it('collapses a burst of invalidate() calls into exactly one fetch, coalesceMs after the LAST call', async () => {
    const clock = new ManualClock()
    const { fetchers, calls } = countingFetchers()
    const store = createServerStateStore({ fetchers, timers: timersFrom(clock) })

    store.invalidate('schedule') // default coalesceMs.schedule = 1_000 -> would fire at t=1000
    await clock.advance(500) // t=500, mid-burst
    expect(calls.schedule).toBe(0)

    store.invalidate('schedule') // resets the window: new deadline t=1500
    await clock.advance(999) // t=1499 -- before the reset deadline
    expect(calls.schedule).toBe(0)

    await clock.advance(1) // t=1500 -- the reset deadline
    expect(calls.schedule).toBe(1)
  })

  it('defaults: sessions coalesces at 10_000ms, every other slice at 1_000ms', async () => {
    const clock = new ManualClock()
    const { fetchers, calls } = countingFetchers()
    const store = createServerStateStore({ fetchers, timers: timersFrom(clock) })

    store.invalidate('sessions')
    store.invalidate('schedule')

    await clock.advance(1_000)
    expect(calls.schedule).toBe(1)
    expect(calls.sessions).toBe(0) // sessions is still coalescing

    await clock.advance(9_000)
    expect(calls.sessions).toBe(1)
  })

  it('coalesceMs is overridable per slice', async () => {
    const clock = new ManualClock()
    const { fetchers, calls } = countingFetchers()
    const store = createServerStateStore({ fetchers, timers: timersFrom(clock), coalesceMs: { health: 250 } })

    store.invalidate('health')
    await clock.advance(249)
    expect(calls.health).toBe(0)

    await clock.advance(1)
    expect(calls.health).toBe(1)
  })

  it('a disconnect inside the coalesce window cancels the pending fetch — never fires into a dead connection', async () => {
    const clock = new ManualClock()
    const { fetchers, calls } = countingFetchers()
    const store = createServerStateStore({ fetchers, timers: timersFrom(clock) })

    store.connectionChanged('open')
    store.invalidate('schedule') // deadline t=1000
    await clock.advance(200)
    store.connectionChanged('closed') // drop mid-window

    await clock.advance(5_000) // well past the coalesce deadline
    expect(calls.schedule).toBe(0)
    expect(store.getStatus('schedule').freshness).toEqual({ kind: 'stale', since: 200, reason: 'disconnected' })

    // Reconnect is an open-after-drop, so rule 4 fires refreshAll once...
    store.connectionChanged('open')
    await flush()
    expect(calls.schedule).toBe(1)

    // ...and a later invalidate starts a fresh window that works normally.
    store.invalidate('schedule')
    await clock.advance(1_000)
    expect(calls.schedule).toBe(2)
  })
})

describe('rule 2: a single in-flight fetch per slice', () => {
  it('a refresh requested while one is already running never starts a second, concurrent fetch', async () => {
    const pf = pendingFetcher()
    const { fetchers, calls } = countingFetchers({ schedule: pf.fetcher })
    const store = createServerStateStore({ fetchers })

    const p1 = store.refresh('schedule')
    const p2 = store.refresh('schedule') // arrives while the first fetch is still in flight

    expect(calls.schedule).toBe(1) // exactly one fetch actually started

    pf.resolveNext() // settle the first pass
    await flush()
    expect(calls.schedule).toBe(2) // pendingAgain queued exactly one more pass, not fired concurrently

    pf.resolveNext() // settle the queued pass
    await Promise.all([p1, p2])
    await flush()

    expect(calls.schedule).toBe(2) // still exactly two — never a third
    expect(store.getStatus('schedule').refreshing).toBe(false)
  })

  it('a third refresh while the queued pass is running still only adds one more pass, never overlapping', async () => {
    const pf = pendingFetcher()
    const { fetchers, calls } = countingFetchers({ schedule: pf.fetcher })
    const store = createServerStateStore({ fetchers })

    void store.refresh('schedule')
    void store.refresh('schedule') // queues pass 2
    void store.refresh('schedule') // still just queues pass 2 (pendingAgain is a flag, not a counter)

    pf.resolveNext()
    await flush()
    expect(calls.schedule).toBe(2)
    expect(store.getStatus('schedule').refreshing).toBe(true) // pass 2 is running

    pf.resolveNext()
    await flush()
    expect(calls.schedule).toBe(2)
    expect(store.getStatus('schedule').refreshing).toBe(false)
  })
})

describe('rule 3: fail-closed freshness', () => {
  it('starts unknown before anything has ever loaded', () => {
    const { fetchers } = countingFetchers()
    const store = createServerStateStore({ fetchers })
    for (const slice of SLICES) expect(store.getStatus(slice).freshness).toEqual({ kind: 'unknown' })
  })

  it('a dropped connection immediately marks every slice stale(disconnected)', () => {
    const clock = new ManualClock()
    const { fetchers } = countingFetchers()
    const store = createServerStateStore({ fetchers, timers: timersFrom(clock) })

    clock.now = 12_345
    store.connectionChanged('closed')

    for (const slice of SLICES) {
      expect(store.getStatus(slice).freshness).toEqual({ kind: 'stale', since: 12_345, reason: 'disconnected' })
    }
  })

  it('reconnecting is treated the same as closed', () => {
    const { fetchers } = countingFetchers()
    const store = createServerStateStore({ fetchers })
    store.connectionChanged('reconnecting')
    expect(store.getStatus('sessions').freshness).toMatchObject({ kind: 'stale', reason: 'disconnected' })
  })

  it('a failed fetch marks its own slice stale(load-failed), leaving the others untouched', async () => {
    const clock = new ManualClock()
    const { fetchers } = countingFetchers({
      schedule: async () => {
        throw new Error('boom')
      }
    })
    const store = createServerStateStore({ fetchers, timers: timersFrom(clock) })
    store.connectionChanged('open')

    await store.refresh('schedule')

    expect(store.getStatus('schedule').freshness).toMatchObject({ kind: 'stale', reason: 'load-failed' })
    expect(store.getStatus('sessions').freshness).toEqual({ kind: 'unknown' })
  })

  it('live/degraded are set ONLY after a successful fetch while the connection is open — never implied', async () => {
    const clock = new ManualClock()
    const { fetchers } = countingFetchers()
    const store = createServerStateStore({ fetchers, timers: timersFrom(clock) })

    // The connection has never opened: a successful fetch must not fabricate freshness.
    await store.refresh('sessions')
    expect(store.getStatus('sessions').freshness).toEqual({ kind: 'unknown' })
    expect(store.getStatus('sessions').lastSyncedAt).not.toBeNull() // the fetch itself did succeed

    store.connectionChanged('open')

    store.setChangeEvents(true)
    await store.refresh('schedule')
    expect(store.getStatus('schedule').freshness).toEqual({ kind: 'live' })

    store.setChangeEvents(false)
    await store.refresh('connections')
    expect(store.getStatus('connections').freshness).toEqual({ kind: 'degraded' })
  })
})

describe('rule 4: reconnect refreshes exactly once, never on the first open', () => {
  it('the first open of a fresh store does not refresh', async () => {
    const clock = new ManualClock()
    const { fetchers, calls } = countingFetchers()
    const store = createServerStateStore({ fetchers, timers: timersFrom(clock) })

    store.connectionChanged('open')
    await flush()

    expect(totalCalls(calls)).toBe(0)
  })

  it('an open that follows a drop refreshes every slice exactly once', async () => {
    const clock = new ManualClock()
    const { fetchers, calls } = countingFetchers()
    const store = createServerStateStore({ fetchers, timers: timersFrom(clock) })

    store.connectionChanged('open') // fresh boot — no refresh owed
    store.connectionChanged('closed')
    store.connectionChanged('open') // reconnect — owes exactly one refresh
    await flush()

    for (const slice of SLICES) expect(calls[slice]).toBe(1)
  })

  it('a fresh gateway.ready resets the change_events gate: a reconnect does not keep the pre-drop cadence', () => {
    const clock = new ManualClock()
    const { fetchers } = countingFetchers()
    const store = createServerStateStore({ fetchers, timers: timersFrom(clock) })

    store.connectionChanged('open')
    store.setChangeEvents(true) // gateway.ready(change_events: true)
    expect(clock.delays.at(-1)).toBe(5 * 60_000) // fast backstop while change_events is known true

    store.connectionChanged('closed')
    store.connectionChanged('open') // reconnected, but no gateway.ready has arrived yet
    expect(clock.delays.at(-1)).toBe(60_000) // fail-closed: assume the slow cadence until reseeded

    store.setChangeEvents(true) // the new gateway.ready arrives
    expect(clock.delays.at(-1)).toBe(5 * 60_000)
  })
})

describe('rule 5: focus refresh with a minimum gap', () => {
  it('refreshes on focus, but not again before focusMinGapMs has elapsed', async () => {
    const clock = new ManualClock()
    const { fetchers, calls } = countingFetchers()
    const store = createServerStateStore({ fetchers, timers: timersFrom(clock) })
    store.connectionChanged('open')

    await store.refreshOnFocus()
    expect(totalCalls(calls)).toBe(SLICES.length)

    await clock.advance(14_999)
    await store.refreshOnFocus()
    expect(totalCalls(calls)).toBe(SLICES.length) // still within the default 15s gap

    await clock.advance(1)
    await store.refreshOnFocus()
    expect(totalCalls(calls)).toBe(SLICES.length * 2)
  })

  it('focusMinGapMs is overridable', async () => {
    const clock = new ManualClock()
    const { fetchers, calls } = countingFetchers()
    const store = createServerStateStore({ fetchers, timers: timersFrom(clock), focusMinGapMs: 5_000 })
    store.connectionChanged('open')

    await store.refreshOnFocus()
    await clock.advance(4_999)
    await store.refreshOnFocus()
    expect(totalCalls(calls)).toBe(SLICES.length)

    await clock.advance(1)
    await store.refreshOnFocus()
    expect(totalCalls(calls)).toBe(SLICES.length * 2)
  })

  it('is a no-op while disconnected — the wiring layer owns the waitForConnection escalation', async () => {
    const { fetchers, calls } = countingFetchers()
    const store = createServerStateStore({ fetchers })

    await store.refreshOnFocus()

    expect(totalCalls(calls)).toBe(0)
  })
})

describe('rule 6: backstop timer', () => {
  it('fires refreshAll every 5 minutes while change_events is available, and reschedules itself', async () => {
    const clock = new ManualClock()
    const { fetchers, calls } = countingFetchers()
    const store = createServerStateStore({ fetchers, timers: timersFrom(clock) })
    store.connectionChanged('open')
    store.setChangeEvents(true)

    await clock.advance(5 * 60_000)
    expect(totalCalls(calls)).toBe(SLICES.length)

    await clock.advance(5 * 60_000)
    expect(totalCalls(calls)).toBe(SLICES.length * 2)
  })

  it('falls back to 60s when change_events is unavailable (old/unknown backend)', async () => {
    const clock = new ManualClock()
    const { fetchers, calls } = countingFetchers()
    const store = createServerStateStore({ fetchers, timers: timersFrom(clock) })
    store.connectionChanged('open') // change_events defaults to false (fail-closed) until a gateway.ready says otherwise

    await clock.advance(60_000)
    expect(totalCalls(calls)).toBe(SLICES.length)
  })

  it('is disabled entirely while disconnected — no fetch is ever fired into a dead connection', async () => {
    const clock = new ManualClock()
    const { fetchers, calls } = countingFetchers()
    const store = createServerStateStore({ fetchers, timers: timersFrom(clock) })
    store.connectionChanged('open')
    store.setChangeEvents(true)
    store.connectionChanged('closed')

    await clock.advance(60 * 60_000) // an hour — nowhere near enough to matter if it had fired

    expect(totalCalls(calls)).toBe(0)
  })
})

describe('rule 7: demo and bridgeMissing are permanent, subscription-free modes', () => {
  it('demo is permanently live, and never calls a fetcher', async () => {
    const { fetchers, calls } = countingFetchers()
    const store = createServerStateStore({ fetchers, mode: 'demo' })

    for (const slice of SLICES) {
      expect(store.getStatus(slice)).toEqual({ freshness: { kind: 'live' }, lastSyncedAt: null, refreshing: false })
    }

    store.invalidate('sessions')
    store.connectionChanged('closed')
    await store.refresh('sessions')
    await store.refreshAll()
    await store.refreshOnFocus()

    expect(totalCalls(calls)).toBe(0)
    expect(store.getStatus('sessions').freshness).toEqual({ kind: 'live' })
  })

  it('bridgeMissing is permanently stale(disconnected), and never calls a fetcher', async () => {
    const { fetchers, calls } = countingFetchers()
    const store = createServerStateStore({ fetchers, mode: 'bridgeMissing' })

    for (const slice of SLICES) {
      expect(store.getStatus(slice).freshness).toMatchObject({ kind: 'stale', reason: 'disconnected' })
    }

    store.invalidate('sessions')
    store.connectionChanged('open')
    await store.refresh('sessions')
    await store.refreshAll()

    expect(totalCalls(calls)).toBe(0)
    expect(store.getStatus('sessions').freshness).toMatchObject({ kind: 'stale', reason: 'disconnected' })
  })
})

describe('subscribe', () => {
  it('notifies listeners with the current status on every change, and stops after unsubscribe', async () => {
    const clock = new ManualClock()
    const { fetchers } = countingFetchers()
    const store = createServerStateStore({ fetchers, timers: timersFrom(clock) })
    const seen: boolean[] = []
    const unsubscribe = store.subscribe('schedule', status => seen.push(status.refreshing))

    store.connectionChanged('open')
    await store.refresh('schedule')
    expect(seen).toEqual([true, false])

    unsubscribe()
    await store.refresh('schedule')
    expect(seen).toEqual([true, false]) // no further notifications after unsubscribe
  })
})
