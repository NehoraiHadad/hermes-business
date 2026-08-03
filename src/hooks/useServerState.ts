import { useCallback, useEffect, useState } from 'react'
import { getServerStateStore } from '../lib/server-state-wiring'
import type { ServerStateSlice, SliceStatus } from '../lib/server-state'
import { hermesClient, type ConnectionState } from '../lib/hermes-client'

// Public contract for partner-feed / any future consumer (docs/specs/live-refresh.md
// §5.5). Never fabricates freshness: before server-state-wiring.ts has run (or in an
// isolated test that never called initServerStateWiring), the slice honestly reads
// 'unknown' rather than pretending to be live — the same fail-closed doctrine as the
// store itself.
const UNKNOWN_STATUS: SliceStatus = { freshness: { kind: 'unknown' }, lastSyncedAt: null, refreshing: false }

/**
 * Subscribes to one slice of the module-level server-state store. The slice's DATA
 * keeps living with its actual owner (useHermesData / a dedicated hook) — this hook
 * only ever returns the freshness contract and a manual, serialized refresh handle.
 */
export function useServerState(slice: ServerStateSlice): {
  status: SliceStatus
  refresh: () => Promise<void>
} {
  const [status, setStatus] = useState<SliceStatus>(() => getServerStateStore()?.getStatus(slice) ?? UNKNOWN_STATUS)

  useEffect(() => {
    const store = getServerStateStore()
    if (!store) {
      setStatus(UNKNOWN_STATUS)
      return
    }
    setStatus(store.getStatus(slice))
    return store.subscribe(slice, setStatus)
  }, [slice])

  const refresh = useCallback(() => {
    const store = getServerStateStore()
    return store ? store.refresh(slice) : Promise.resolve()
  }, [slice])

  return { status, refresh }
}

type OverallConnectionState = 'connected' | 'reconnecting' | 'disconnected'

function mapConnectionState(state: ConnectionState): OverallConnectionState {
  if (state === 'open') return 'connected'
  if (state === 'reconnecting') return 'reconnecting'
  return 'disconnected'
}

/** Global connection banner state: source of truth is the transport itself (§4), not
 *  the store — a dropped socket is honest regardless of which slices exist. */
export function useConnectionStatus(): { state: OverallConnectionState; since: number | null } {
  const [state, setState] = useState<OverallConnectionState>(() => mapConnectionState(hermesClient.connectionState))
  const [since, setSince] = useState<number | null>(() =>
    hermesClient.connectionState === 'open' ? null : Date.now()
  )

  useEffect(() => {
    // Demo has no socket to lose (hermesClient.connectionState is a permanent 'open');
    // a missing bridge never connects at all. Neither ever emits onConnectionChange,
    // so both are set once here rather than left to a subscription that will never fire.
    if (hermesClient.demo) {
      setState('connected')
      setSince(null)
      return
    }
    if (hermesClient.bridgeMissing) {
      setState('disconnected')
      setSince(prev => prev ?? Date.now())
      return
    }
    return hermesClient.onConnectionChange(next => {
      const mapped = mapConnectionState(next)
      setState(mapped)
      setSince(mapped === 'connected' ? null : Date.now())
    })
  }, [])

  return { state, since }
}
