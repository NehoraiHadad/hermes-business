// @vitest-environment jsdom
import '../test/setup-dom'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePartnerFeed } from './usePartnerFeed'
import { bridge, stubBridge } from '../test/hermes-bridge'
import { __resetServerStateWiringForTests, initServerStateWiring } from '../lib/server-state-wiring'
import type { ServerStateSlice } from '../lib/server-state'

// docs/specs/partner-feed.md §7 / §11 stage 4-5 contract: fetch only once "active"
// (entering the tasks screen), refresh() is idempotent + in-flight-deduped, a
// rejected fetch never throws (resolves into an honest available:false feed), and
// (live-refresh phase 3, documented deviation from §7's literal standalone-focus
// fallback) a freshness transition on the 'partner' server-state slice triggers a
// refetch of our own snapshot.

function emptySnapshot(overrides: Partial<PartnerFeedSnapshot> = {}): PartnerFeedSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    available: true,
    cron: { ok: true, jobs: [] },
    sessions: { ok: true, rows: [] },
    curator: { ok: true, insights: { available: false, curator: null, learning: null } },
    ...overrides
  }
}

function noopFetchers() {
  const slices: ServerStateSlice[] = ['sessions', 'schedule', 'connections', 'health', 'partner']
  const fetchers = {} as Record<ServerStateSlice, () => Promise<void>>
  for (const slice of slices) fetchers[slice] = async () => {}
  return fetchers
}

afterEach(() => {
  __resetServerStateWiringForTests()
})

describe('usePartnerFeed — fetch gating', () => {
  it('never fetches while inactive', () => {
    stubBridge({ getPartnerFeed: vi.fn(async () => emptySnapshot()) })
    const { result } = renderHook(() => usePartnerFeed(false))
    expect(result.current.feed).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(bridge().getPartnerFeed).not.toHaveBeenCalled()
  })

  it('fetches once, the first time active becomes true — "entering the screen", not at mount', async () => {
    const snapshot = emptySnapshot()
    stubBridge({ getPartnerFeed: vi.fn(async () => snapshot) })
    const { result, rerender } = renderHook(({ active }: { active: boolean }) => usePartnerFeed(active), {
      initialProps: { active: false }
    })
    expect(bridge().getPartnerFeed).not.toHaveBeenCalled()

    rerender({ active: true })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(bridge().getPartnerFeed).toHaveBeenCalledTimes(1)
    expect(result.current.feed).toEqual({
      items: [],
      degraded: { cron: false, sessions: false, curator: false },
      available: true
    })
    expect(result.current.loading).toBe(false)
  })

  it('going inactive again does not clear the last known feed', async () => {
    stubBridge({ getPartnerFeed: vi.fn(async () => emptySnapshot()) })
    const { result, rerender } = renderHook(({ active }: { active: boolean }) => usePartnerFeed(active), {
      initialProps: { active: true }
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.feed).not.toBeNull()

    rerender({ active: false })
    expect(result.current.feed).not.toBeNull()
    expect(bridge().getPartnerFeed).toHaveBeenCalledTimes(1)
  })

  // A1 fix: a background session created while the owner was on another screen
  // must become visible on RE-ENTRY, not only on the very first activation.
  it('re-entry refetches: activate -> deactivate -> activate fires a second fetch, keeping the last feed visible meanwhile', async () => {
    let resolveSecond: (value: PartnerFeedSnapshot) => void = () => {}
    const getPartnerFeed = vi
      .fn<() => Promise<PartnerFeedSnapshot>>()
      .mockImplementationOnce(async () => emptySnapshot())
      .mockImplementationOnce(
        () =>
          new Promise<PartnerFeedSnapshot>(resolve => {
            resolveSecond = resolve
          })
      )
    stubBridge({ getPartnerFeed })
    const { result, rerender } = renderHook(({ active }: { active: boolean }) => usePartnerFeed(active), {
      initialProps: { active: false }
    })

    rerender({ active: true })
    await act(async () => {
      await Promise.resolve()
    })
    expect(bridge().getPartnerFeed).toHaveBeenCalledTimes(1)
    const firstFeed = result.current.feed
    expect(firstFeed).not.toBeNull()

    rerender({ active: false })
    rerender({ active: true })
    expect(bridge().getPartnerFeed).toHaveBeenCalledTimes(2)
    // The second fetch is still in flight — the last-known feed must keep
    // rendering rather than resetting to null/loading.
    expect(result.current.feed).toBe(firstFeed)
    expect(result.current.loading).toBe(true)

    await act(async () => {
      resolveSecond(emptySnapshot())
      await Promise.resolve()
    })
    expect(result.current.loading).toBe(false)
  })
})

describe('usePartnerFeed — refresh() idempotence', () => {
  it('dedupes two concurrent refresh() calls into a single in-flight bridge call', async () => {
    let resolveFetch: (value: PartnerFeedSnapshot) => void = () => {}
    const pending = new Promise<PartnerFeedSnapshot>(resolve => {
      resolveFetch = resolve
    })
    stubBridge({ getPartnerFeed: vi.fn(() => pending) })
    const { result } = renderHook(() => usePartnerFeed(true))

    let first: Promise<void> | undefined
    let second: Promise<void> | undefined
    act(() => {
      first = result.current.refresh()
      second = result.current.refresh()
    })

    expect(bridge().getPartnerFeed).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)

    await act(async () => {
      resolveFetch(emptySnapshot())
      await first
    })
    expect(result.current.loading).toBe(false)

    // A call AFTER the first settles is a fresh, non-deduped fetch.
    await act(async () => {
      await result.current.refresh()
    })
    expect(bridge().getPartnerFeed).toHaveBeenCalledTimes(2)
  })

  it('never throws on a rejected fetch — resolves into an honest available:false feed', async () => {
    stubBridge({
      getPartnerFeed: vi.fn(async () => {
        throw new Error('hermes desktop bridge is unavailable')
      })
    })
    const { result } = renderHook(() => usePartnerFeed(true))

    await act(async () => {
      await expect(result.current.refresh()).resolves.toBeUndefined()
    })

    expect(result.current.feed).toEqual({
      items: [],
      degraded: { cron: true, sessions: true, curator: true },
      available: false
    })
    expect(result.current.loading).toBe(false)
  })
})

describe('usePartnerFeed — live-refresh subscription (partner slice)', () => {
  it('refetches when the partner slice freshness transitions after a real fetch already happened', async () => {
    stubBridge({ getPartnerFeed: vi.fn(async () => emptySnapshot()) })
    const store = initServerStateWiring(noopFetchers())
    renderHook(() => usePartnerFeed(true))

    await act(async () => {
      await Promise.resolve()
    })
    expect(bridge().getPartnerFeed).toHaveBeenCalledTimes(1)

    await act(async () => {
      store.connectionChanged('open')
      await store.refresh('partner')
    })

    expect(bridge().getPartnerFeed).toHaveBeenCalledTimes(2)
  })

  it('does NOT refetch on a partner-slice transition before the panel has ever been active', async () => {
    stubBridge({ getPartnerFeed: vi.fn(async () => emptySnapshot()) })
    const store = initServerStateWiring(noopFetchers())
    renderHook(() => usePartnerFeed(false))

    await act(async () => {
      store.connectionChanged('open')
      await store.refresh('partner')
    })

    expect(bridge().getPartnerFeed).not.toHaveBeenCalled()
  })
})

// A1 fix, second half: a background session (e.g. a Telegram message arriving
// while the owner is elsewhere) invalidates the 'sessions' slice, not 'partner' —
// the feed blends cron runs, sessions and curator notes, so this transition must
// reach usePartnerFeed too, with the exact same gating as the 'partner' slice.
describe('usePartnerFeed — live-refresh subscription (sessions slice)', () => {
  it('refetches when the sessions slice freshness transitions after a real fetch already happened', async () => {
    stubBridge({ getPartnerFeed: vi.fn(async () => emptySnapshot()) })
    const store = initServerStateWiring(noopFetchers())
    renderHook(() => usePartnerFeed(true))

    await act(async () => {
      await Promise.resolve()
    })
    expect(bridge().getPartnerFeed).toHaveBeenCalledTimes(1)

    await act(async () => {
      store.connectionChanged('open')
      await store.refresh('sessions')
    })

    expect(bridge().getPartnerFeed).toHaveBeenCalledTimes(2)
  })

  it('does NOT refetch on a sessions-slice transition before the panel has ever been active', async () => {
    stubBridge({ getPartnerFeed: vi.fn(async () => emptySnapshot()) })
    const store = initServerStateWiring(noopFetchers())
    renderHook(() => usePartnerFeed(false))

    await act(async () => {
      store.connectionChanged('open')
      await store.refresh('sessions')
    })

    expect(bridge().getPartnerFeed).not.toHaveBeenCalled()
  })
})

// A4 fix: mirrors useCompanionUpdate.test.tsx's unmount guard — an in-flight
// getPartnerFeed() call that settles AFTER the owner unmounts must never call
// setState on the unmounted hook (no act-outside-of-test warning, no stale write).
describe('usePartnerFeed — unmount guard (A4)', () => {
  it('does not update state after unmount', async () => {
    let resolveFetch: (value: PartnerFeedSnapshot) => void = () => {}
    const pending = new Promise<PartnerFeedSnapshot>(resolve => {
      resolveFetch = resolve
    })
    stubBridge({ getPartnerFeed: vi.fn(() => pending) })
    const { result, unmount } = renderHook(() => usePartnerFeed(true))

    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.loading).toBe(true)

    unmount()
    resolveFetch(emptySnapshot())
    // Reaching here without an act()-outside-of-test-warning proves the mounted
    // guard held; there is no meaningful assertion on `result.current` post-unmount.
    await pending
  })
})
