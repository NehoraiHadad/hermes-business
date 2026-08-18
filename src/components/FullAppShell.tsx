import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import type { useChat } from '../hooks/useChat'
import { readDismissedVersion, writeDismissedVersion } from '../hooks/useCompanionUpdate'
import type { useHermesData } from '../hooks/useHermesData'
import { usePartnerFeed } from '../hooks/usePartnerFeed'
import type { useSupportActions } from '../hooks/useSupportActions'
import { FeedUnseenContext } from '../lib/feed-unseen-context'
import { hermesClient } from '../lib/hermes-client'
import type { ToastMessage, ToastSeverity } from '../lib/toast'
import type { Connection, Screen, TaskActions } from '../types'
import { MainScreen } from './MainScreen'
import { Sidebar } from './layout/Sidebar'
import { Topbar } from './layout/Topbar'

type FullSurface = 'desktop' | 'dashboard' | 'logs' | 'settings'

// localStorage seen-marker for the Sidebar's "new activity" nav badge (spec §6.4).
// A client-side viewed-marker only, never treated as evidence — reading it, or
// having localStorage unavailable, must never crash navigation.
const FEED_SEEN_STORAGE_KEY = 'hermes-business-feed-seen-v1'

function readFeedSeenAt(): number {
  try {
    const raw = localStorage.getItem(FEED_SEEN_STORAGE_KEY)
    const parsed = raw ? Number(raw) : 0
    return Number.isFinite(parsed) ? parsed : 0
  } catch {
    return 0
  }
}

export function FullAppShell({
  screen,
  setScreen,
  title,
  data,
  chat,
  support,
  toast,
  setToast,
  chatScreen,
  modalLayer,
  onOpenFull,
  onMini,
  onAddTask,
  taskActions,
  onAddSkill,
  onOpenConnection,
  onOpenSession
}: {
  screen: Screen
  setScreen: Dispatch<SetStateAction<Screen>>
  title: string
  data: ReturnType<typeof useHermesData>
  chat: ReturnType<typeof useChat>
  support: ReturnType<typeof useSupportActions>
  toast: ToastMessage | null
  // Same channel App.tsx's useToasts() already exposes as `notify` (info by
  // default, `'error'` lingers longer) — the passive companion-update banner
  // below (B1) reuses this exact system rather than inventing a second one.
  setToast: (message: string, severity?: ToastSeverity) => void
  chatScreen: ReactNode
  modalLayer: ReactNode
  onOpenFull: (surface: FullSurface) => void
  onMini: () => Promise<void>
  onAddTask: () => void
  taskActions: TaskActions
  onAddSkill: () => void
  onOpenConnection: (connection: Connection) => void
  // CTA target for a partner-feed item (docs/specs/partner-feed.md §6.2): opens the
  // real conversation transcript in chat, never a synthesized summary.
  onOpenSession: (sessionId: string) => void
}) {
  // Partner-visibility feed (docs/specs/partner-feed.md §7/§11 stage 4-5): ONE hook
  // instance lives here (not inside TasksScreen) so its last-known snapshot survives
  // navigating away from "פעילות ומשימות" — the Sidebar badge below needs to keep
  // showing the count after the user leaves the screen, not reset to "loading".
  // `active` gates the very first fetch to the moment the owner actually enters the
  // tasks screen (never at FullAppShell mount, since the app always boots on 'chat').
  const { feed, loading: feedLoading, refresh: refreshFeed } = usePartnerFeed(screen === 'tasks')

  const [feedSeenAt, setFeedSeenAt] = useState<number>(() => readFeedSeenAt())
  // Spec §6.4: the seen-marker resets to "now" every time the owner enters the
  // activity screen — clearing the badge, since everything currently in the feed has
  // now been seen. Re-fires on every re-entry, not just the first.
  useEffect(() => {
    if (screen !== 'tasks') return
    const now = Date.now()
    try {
      localStorage.setItem(FEED_SEEN_STORAGE_KEY, String(now))
    } catch {
      // Best-effort only — a blocked/full localStorage must never break navigation.
    }
    setFeedSeenAt(now)
  }, [screen])

  // Only items with a PROVEN timestamp newer than the marker count as "new" — an
  // at:null item's recency is unproven, so (fail-closed) it is never counted here,
  // exactly like it is never windowed out of the panel itself (src/lib/partner-feed.ts).
  const feedUnseenCount = useMemo(() => {
    if (!feed) return 0
    return feed.items.filter(item => item.at !== null && item.at > feedSeenAt).length
  }, [feed, feedSeenAt])

  // Passive companion-update surface (B1 fix, docs/specs/versioning.md §7.2): before
  // this, the ONLY subscriber to the main process's passive push
  // (hermes:companion-update-available — first possible ~60s after boot, then
  // whenever the main process's re-arming 24h schedule or a return from the tray
  // clears the durable throttle) was
  // useCompanionUpdate(), mounted exclusively inside SupportUpdatePanel — i.e. only
  // while the owner already had the support screen open. A push that arrived while
  // they were anywhere else in the app was silently dropped: no toast, no nav
  // indicator, dismiss()/dismissedVersion were never even called. This is the
  // always-mounted counterpart. It does not own the CHECK itself (still 100%
  // main-process, plus useCompanionUpdate's own explicit check() path in
  // SupportUpdatePanel) — only "was a pushed update-available verdict ever
  // announced, and has the owner seen it", persisted through the SAME
  // dismissedVersion localStorage key useCompanionUpdate.ts owns (its read/write
  // helpers are exported from there for exactly this reuse, so both the support
  // screen's own hook instance and this banner agree on one seen-marker).
  const [dismissedVersion, setDismissedVersionState] = useState<string | null>(() => readDismissedVersion())
  const [pushedVersion, setPushedVersion] = useState<string | null>(null)
  // Guards the one-time-per-version toast (spec §7.2, "פעם אחת לכל גרסת יעד"): a
  // push for a version already announced this session — including across a
  // StrictMode dev double-mount, which tears the subscription down and
  // resubscribes but never re-delivers a past one-shot event — or already
  // dismissed in a prior session, never re-announces.
  const announcedVersionRef = useRef<string | null>(null)

  useEffect(() => {
    return hermesClient.onCompanionUpdateAvailable(status => {
      if (status.status !== 'update-available' || !status.latest) return
      const latest = status.latest
      setPushedVersion(latest)
      if (latest === announcedVersionRef.current || latest === readDismissedVersion()) return
      announcedVersionRef.current = latest
      setToast("גרסה חדשה של תכל'ס זמינה — פרטים במסך תמיכה", 'info')
    })
  }, [setToast])

  // Entering the support screen marks the pushed version seen: persists it as
  // dismissed (same key/helpers as above) and clears the nav indicator.
  useEffect(() => {
    if (screen !== 'support' || pushedVersion === null || pushedVersion === dismissedVersion) return
    writeDismissedVersion(pushedVersion)
    setDismissedVersionState(pushedVersion)
  }, [screen, pushedVersion, dismissedVersion])

  const updateIndicatorVisible = pushedVersion !== null && pushedVersion !== dismissedVersion

  // "Not now" from the banner below: the SAME seen-marker the support screen
  // writes (one key, one meaning), so a version put aside here never
  // re-announces from anywhere — exactly the one-time-per-version contract
  // announcedVersionRef enforces for the toast.
  const dismissPushedVersion = () => {
    if (pushedVersion === null) return
    writeDismissedVersion(pushedVersion)
    setDismissedVersionState(pushedVersion)
  }

  return (
    <div className="app-shell">
      <Sidebar
        screen={screen}
        setScreen={setScreen}
        sessions={data.sessions}
        activeSession={chat.activeSession}
        onSelectSession={chat.selectSession}
        onNewSession={chat.newSession}
        runtime={data.runtime}
        taskCount={data.tasks.length}
        feedUnseenCount={feedUnseenCount}
      />
      <div className="app-main">
        <Topbar
          title={title}
          runtime={data.runtime}
          onOpenFull={onOpenFull}
          onNavigate={setScreen}
          onMini={onMini}
          hasUpdateIndicator={updateIndicatorVisible}
        />
        {/* The toast says an update exists and then fades; the gear dot says it
            quietly and forever. Neither one takes the owner anywhere, so the
            announcement used to end in "פרטים במסך תמיכה" and leave them to find
            it. This strip is the CTA for that: same visibility rule as the gear
            dot (so it disappears the moment the version is marked seen — on
            entering the support screen or on "לא עכשיו"), never a blocking
            modal, and it navigates rather than starting anything by itself:
            downloading and installing stay behind their own explicit consent in
            the support panel. */}
        {updateIndicatorVisible ? (
          <div className="update-banner" role="status">
            <span className="update-banner__text">
              יש גרסה חדשה של תכל'ס{pushedVersion ? <> (<bdi dir="ltr">{pushedVersion}</bdi>)</> : null}
            </span>
            <div className="update-banner__actions">
              <button className="primary-button primary-button--small" onClick={() => setScreen('support')}>
                מעבר לעדכון
              </button>
              <button className="ghost-button" onClick={dismissPushedVersion}>
                לא עכשיו
              </button>
            </div>
          </div>
        ) : null}
        {/* `chatScreen` is wrapped in FeedUnseenContext below: the home screen's
            "מצב העסק" strip reads the unseen count from there — the same
            `feedUnseenCount` the Sidebar badge above renders, PUBLISHED rather
            than recomputed (a second usePartnerFeed instance would fetch again
            and could disagree with the badge). It is provided here, at the point
            of use, because App.tsx builds `chatScreen` as an opaque node. */}
        <MainScreen
          screen={screen}
          chatScreen={<FeedUnseenContext.Provider value={feedUnseenCount}>{chatScreen}</FeedUnseenContext.Provider>}
          tasks={data.tasks}
          skills={data.skills}
          connections={data.connections}
          runtime={data.runtime}
          versions={data.versions}
          provider={data.providerStatus}
          loadErrors={data.loadErrors}
          support={support}
          toast={toast?.message ?? ''}
          onAddTask={onAddTask}
          taskActions={taskActions}
          onAddSkill={onAddSkill}
          onOpenConnection={onOpenConnection}
          feed={feed}
          feedLoading={feedLoading}
          onRefreshFeed={refreshFeed}
          onOpenSession={onOpenSession}
        />
      </div>
      {modalLayer}
      {toast ? (
        <div className="floating-toast" role="status" aria-live="polite">
          {toast.severity === 'error' ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />} {toast.message}
        </div>
      ) : null}
    </div>
  )
}
