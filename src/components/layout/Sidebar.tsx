import { MessageSquarePlus } from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import { NAV_ITEMS } from '../../constants'
import { hermesClient } from '../../lib/hermes-client'
import { describeSessionTime } from '../../lib/relative-time'
import type { Screen, Session } from '../../types'
import { Logo } from '../ui/Logo'
import { StatusPill } from '../ui/StatusPill'

// How many conversations the list shows before the "הצג עוד" toggle. A cap keeps the
// sidebar scannable; it must never make the older conversations unreachable.
const COLLAPSED_SESSION_LIMIT = 8

const SessionRow = memo(function SessionRow({
  session,
  active,
  now,
  onSelect
}: {
  session: Session
  active: boolean
  // Passed in (never read from the clock inside this memoized row) so the row both
  // re-renders on the parent's minute tick and stays skippable between ticks.
  now: number
  onSelect: (session: Session) => void
}) {
  const when = describeSessionTime(session.started_at, now)
  return (
    <button className={`session-row ${active ? 'session-row--active' : ''}`} onClick={() => onSelect(session)}>
      <span className="session-row__title">{session.title || 'שיחה ללא כותרת'}</span>
      <span className="session-row__preview">{session.preview || 'אין תצוגה מקדימה'}</span>
      <span className="session-row__meta">
        {session.source === 'telegram' ? 'Telegram · ' : ''}
        {when.label ? (
          // The exact moment travels with the phrase (tooltip + machine-readable
          // instant), so the relative wording can always be checked against it.
          <time dateTime={when.iso ?? undefined} title={when.exact ?? undefined}>
            {when.label}
          </time>
        ) : (
          // Hermes gave us no usable start time — say so, exactly like the other
          // screens do for a value they could not prove.
          'מועד לא ידוע'
        )}
      </span>
    </button>
  )
})

export function Sidebar({
  screen,
  setScreen,
  sessions,
  activeSession,
  onSelectSession,
  onNewSession,
  runtime,
  taskCount,
  feedUnseenCount
}: {
  screen: Screen
  setScreen: (screen: Screen) => void
  sessions: Session[]
  activeSession: string
  onSelectSession: (session: Session) => void
  onNewSession: () => void
  runtime: HermesRuntime | null
  taskCount: number
  // Partner-feed items newer than the localStorage seen-marker (docs/specs/partner-feed.md
  // §6.4) — a client-side "you haven't looked at this yet" hint, not proof of anything.
  feedUnseenCount: number
}) {
  const [expanded, setExpanded] = useState(false)
  // One coarse tick so the relative times below do not silently freeze while the
  // window stays open — and only one, since a Date.now() read per render would give
  // every SessionRow a new `now` and defeat its memo.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const visibleSessions = expanded ? sessions : sessions.slice(0, COLLAPSED_SESSION_LIMIT)
  const hiddenCount = sessions.length - COLLAPSED_SESSION_LIMIT

  return (
    <aside className="sidebar sidebar--simple">
      <div className="brand">
        <Logo />
        <div>
          <strong>תכל'ס</strong>
          <span>עובדים יחד, בשיחה אחת</span>
        </div>
      </div>

      <button className="new-chat-button" onClick={onNewSession}>
        <MessageSquarePlus size={19} />
        שיחה חדשה
      </button>

      <nav className="main-nav" aria-label="ניווט ראשי">
        {NAV_ITEMS.map(item => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              className={screen === item.id ? 'main-nav__item main-nav__item--active' : 'main-nav__item'}
              onClick={() => setScreen(item.id)}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{item.label}</span>
              {/* Two different numbers can sit on this one row, so each says what it
                  counts (in the button's accessible name and in a tooltip) instead of
                  leaving the reader with two bare digits side by side. */}
              {item.id === 'tasks' && taskCount > 0 ? (
                <span className="nav-count" aria-label={`${taskCount} משימות מתוזמנות`} title="משימות מתוזמנות">
                  {taskCount}
                </span>
              ) : null}
              {item.id === 'tasks' && feedUnseenCount > 0 ? (
                <span
                  className="nav-badge"
                  aria-label={`${feedUnseenCount} עדכוני פעילות חדשים`}
                  title="עדכונים חדשים שעוד לא ראית"
                >
                  {feedUnseenCount}
                </span>
              ) : null}
            </button>
          )
        })}
      </nav>

      {visibleSessions.length ? (
        <>
          <div className="sidebar__divider" />
          <div className="sessions-title sessions-title--simple">
            <span>שיחות אחרונות</span>
            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={() => setExpanded(value => !value)}
                aria-expanded={expanded}
                aria-controls="sidebar-session-list"
              >
                {expanded ? 'הצג פחות' : `הצג עוד (${hiddenCount})`}
              </button>
            ) : null}
          </div>
          <div className="session-list" id="sidebar-session-list">
            {visibleSessions.map(session => (
              <SessionRow
                key={session.id}
                session={session}
                active={screen === 'chat' && activeSession === session.id}
                now={now}
                onSelect={onSelectSession}
              />
            ))}
          </div>
        </>
      ) : null}

      <div className="sidebar__footer">
        <StatusPill runtime={runtime} demo={hermesClient.demo} />
      </div>
    </aside>
  )
}
