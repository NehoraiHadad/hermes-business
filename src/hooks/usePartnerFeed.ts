import { useCallback, useEffect, useRef, useState } from 'react'
import { hermesClient } from '../lib/hermes-client'
import { derivePartnerFeed, type PartnerFeed } from '../lib/partner-feed'
import { useServerState } from './useServerState'

// Fail-closed placeholder for a call that never even produced a snapshot (bridge
// missing/thrown, not just a single degraded source — main-process
// electron/partner-feed.cjs already turns per-source failures into `ok:false` with
// `available` still true when at least one source answered; this is the "the whole
// IPC call blew up" case). Never rendered as "no activity" — PartnerFeedPanel must
// read `available:false` here exactly like a snapshot whose sources all failed.
const UNAVAILABLE_FEED: PartnerFeed = {
  items: [],
  degraded: { cron: true, sessions: true, curator: true },
  available: false
}

export type UsePartnerFeedResult = {
  feed: PartnerFeed | null // null = never fetched yet (loading state); see `loading`
  loading: boolean
  refresh: () => Promise<void>
}

/**
 * Loads and derives the partner-visibility feed (docs/specs/partner-feed.md §7,
 * §11 stage 4/5). `active` gates every fetch: pass `screen === 'tasks'` from the
 * caller so a request only fires the moment the owner actually (re-)opens
 * "פעילות ומשימות" — never at app boot (spec §7 rule 1), but also never only
 * ONCE — every false→true transition refetches (A1 fix), so a background session
 * created while the owner was on another screen becomes visible on return instead
 * of staying invisible until an unrelated live-refresh event happened to fire.
 * Once fetched, the hook keeps the last snapshot alive even if `active` later goes
 * back to false, so a caller that holds this hook at a stable parent (e.g.
 * FullAppShell, for the Sidebar's unseen-count badge) keeps seeing the last known
 * feed while the user is on another screen, rather than resetting to "loading" on
 * every navigation away and back — the same "never clear, only replace on settle"
 * behavior also covers the re-entry refetch itself.
 *
 * `refresh` is idempotent and safe to call concurrently: a call made while another
 * is still in flight returns the SAME in-flight promise instead of firing a second
 * request. It never throws — a failure (missing bridge, rejected IPC call) resolves
 * into an honest `available:false` feed, exactly like a snapshot whose sources all
 * failed to answer.
 */
export function usePartnerFeed(active: boolean): UsePartnerFeedResult {
  const [feed, setFeed] = useState<PartnerFeed | null>(null)
  const [loading, setLoading] = useState(false)
  const inFlightRef = useRef<Promise<void> | null>(null)
  // Unmount guard (mirrors useCompanionUpdate.ts's `mounted` ref): the in-flight
  // getPartnerFeed() promise, and any of the effects below that call refresh() off
  // a subscription, can still settle after this hook's owner (FullAppShell) is
  // gone. Without this, that late settle would call setState on an unmounted
  // component.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current
    setLoading(true)
    const task = hermesClient
      .getPartnerFeed()
      .then(snapshot => {
        if (mounted.current) setFeed(derivePartnerFeed(snapshot, Date.now()))
      })
      .catch(() => {
        if (mounted.current) setFeed(UNAVAILABLE_FEED)
      })
      .finally(() => {
        if (mounted.current) setLoading(false)
        inFlightRef.current = null
      })
    inFlightRef.current = task
    return task
  }, [])

  // Trigger 1 (spec §7, extended by A1 re-entry fix): refetch on EVERY false→true
  // transition of `active` — i.e. every time the owner (re-)enters the tasks
  // screen — never merely because this hook mounted, and never merely because
  // `active` stays true across an unrelated re-render. The original version only
  // fetched on the FIRST activation (a one-shot `everActiveRef` gate), so a
  // background session created while the owner was on another screen stayed
  // invisible until a live-refresh slice happened to fire. `refresh()` never
  // clears `feed` up front (it only ever replaces it once the new snapshot, or an
  // honest failure, settles) — so the last-known feed keeps rendering through the
  // in-flight refetch instead of flashing back to the loading state.
  const wasActiveRef = useRef(false)
  const everActiveRef = useRef(false)
  useEffect(() => {
    const wasActive = wasActiveRef.current
    wasActiveRef.current = active
    if (!active || wasActive) return
    everActiveRef.current = true
    void refresh()
  }, [active, refresh])

  // Live-refresh phase 3 landed (docs/specs/live-refresh.md): cron.changed already
  // invalidates the 'partner' slice (src/lib/server-state-wiring.ts's
  // defaultFetchers), so a fresh sync of THAT slice is evidence our own cron-run
  // snapshot may be stale too. DEVIATION from partner-feed.md §7's literal plan (a
  // standalone `useServerRefresh`-shaped fallback with its own 60s focus timer):
  // that spec explicitly wrote its interface as "what we assume until the sibling
  // spec supplies it" — it now exists as useServerState, so we consume its real
  // freshness transitions instead of hand-rolling a parallel poller that would just
  // double-fetch on top of it. Only re-fetch after at least one real fetch has
  // happened (everActiveRef) — before that there is nothing stale to refresh, and
  // firing a background request purely because of a WS event, before the owner has
  // ever opened this screen, would reintroduce the "fetch at app boot" pattern
  // §7 rule 1 explicitly rules out.
  const { status: partnerStatus } = useServerState('partner')
  const lastPartnerSyncedRef = useRef(partnerStatus.lastSyncedAt)
  useEffect(() => {
    if (partnerStatus.lastSyncedAt === lastPartnerSyncedRef.current) return
    lastPartnerSyncedRef.current = partnerStatus.lastSyncedAt
    if (everActiveRef.current) void refresh()
  }, [partnerStatus.lastSyncedAt, refresh])

  // A1 fix, second half: a background session (Telegram/WhatsApp reply etc.)
  // invalidates the 'sessions' slice, not 'partner' — the partner-feed snapshot
  // itself blends cron runs, sessions and curator notes (src/lib/partner-feed.ts),
  // so a sessions.changed-driven refresh must reach this feed too, exactly like the
  // 'partner' subscription above. Same gating (only after the panel has ever been
  // active) and same "never clear, just refetch" behavior.
  const { status: sessionsStatus } = useServerState('sessions')
  const lastSessionsSyncedRef = useRef(sessionsStatus.lastSyncedAt)
  useEffect(() => {
    if (sessionsStatus.lastSyncedAt === lastSessionsSyncedRef.current) return
    lastSessionsSyncedRef.current = sessionsStatus.lastSyncedAt
    if (everActiveRef.current) void refresh()
  }, [sessionsStatus.lastSyncedAt, refresh])

  return { feed, loading, refresh }
}
