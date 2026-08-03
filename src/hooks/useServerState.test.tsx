// @vitest-environment jsdom
import '../test/setup-dom'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useConnectionStatus, useServerState } from './useServerState'
import { __resetServerStateWiringForTests, initServerStateWiring } from '../lib/server-state-wiring'
import { hermesClient } from '../lib/hermes-client'
import { FakeWebSocket } from '../lib/hermes/fake-websocket'
import type { ServerStateSlice } from '../lib/server-state'

const ALL_SLICES: ServerStateSlice[] = ['sessions', 'schedule', 'connections', 'health', 'partner']

function noopFetchers() {
  const fetchers = {} as Record<ServerStateSlice, () => Promise<void>>
  for (const slice of ALL_SLICES) fetchers[slice] = async () => {}
  return fetchers
}

afterEach(() => {
  __resetServerStateWiringForTests()
  vi.unstubAllGlobals()
})

describe('useServerState', () => {
  it('reads unknown before any wiring has run — never fabricates freshness', () => {
    const { result } = renderHook(() => useServerState('schedule'))
    expect(result.current.status).toEqual({ freshness: { kind: 'unknown' }, lastSyncedAt: null, refreshing: false })
  })

  it('mirrors the store status live via subscribe, and stops updating after unmount', async () => {
    const store = initServerStateWiring(noopFetchers())
    const { result, unmount } = renderHook(() => useServerState('schedule'))

    expect(result.current.status.freshness).toEqual({ kind: 'unknown' })

    await act(async () => {
      store.connectionChanged('open') // change_events unset -> a success while open reads 'degraded'
      await store.refresh('schedule')
    })
    expect(result.current.status.freshness).toEqual({ kind: 'degraded' })
    expect(result.current.status.lastSyncedAt).not.toBeNull()

    const beforeUnmount = result.current.status
    unmount()

    // Further store activity must not touch the unmounted hook's state (no act
    // warning if the subscription was actually torn down on unmount).
    await act(async () => {
      await store.refresh('schedule')
    })
    expect(result.current.status).toBe(beforeUnmount)
  })

  it('refresh() delegates to the store\'s serialized per-slice refresh', async () => {
    const store = initServerStateWiring(noopFetchers())
    const spy = vi.spyOn(store, 'refresh')
    const { result } = renderHook(() => useServerState('connections'))

    await act(async () => {
      await result.current.refresh()
    })

    expect(spy).toHaveBeenCalledWith('connections')
  })

  it('refresh() before any wiring is a safe no-op', async () => {
    const { result } = renderHook(() => useServerState('health'))
    await expect(result.current.refresh()).resolves.toBeUndefined()
  })
})

describe('useConnectionStatus', () => {
  it('starts disconnected when the (never-connected) hermesClient singleton has no open socket', () => {
    const { result, unmount } = renderHook(() => useConnectionStatus())
    expect(hermesClient.demo).toBe(false)
    expect(hermesClient.bridgeMissing).toBe(false)
    expect(result.current.state).toBe('disconnected')
    expect(typeof result.current.since).toBe('number')
    unmount()
  })

  // useConnectionStatus reads the real hermesClient singleton by design (§4: the
  // transport's ConnectionState is the one source of truth for staleness — no
  // injectable client seam). So this test drives the SINGLETON's own transport
  // directly via hermesClient.connect(), exactly like the app's real boot() path,
  // with the global WebSocket swapped for the deterministic fake.
  it('tracks the singleton transport through open -> closed -> reconnecting', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    FakeWebSocket.instances = []
    const { result, unmount } = renderHook(() => useConnectionStatus())
    expect(result.current.state).toBe('disconnected')

    try {
      const opened = hermesClient.connect('ws://hermes/dashboard')
      act(() => {
        FakeWebSocket.instances.at(-1)!.open()
      })
      await opened
      expect(result.current.state).toBe('connected')
      expect(result.current.since).toBeNull()

      act(() => {
        FakeWebSocket.instances.at(-1)!.close()
      })
      // close() synchronously reports 'closed' and then (armed + autoReconnect)
      // schedules a reconnect, which flips to 'reconnecting' within the same
      // dispatch — only the final state is observable from here.
      expect(result.current.state).toBe('reconnecting')
      expect(typeof result.current.since).toBe('number')
    } finally {
      // Stop the real reconnect loop so it can't leak a pending timer past this test.
      hermesClient.disconnect()
      unmount()
    }
  })
})
