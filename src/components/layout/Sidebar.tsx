import { ChevronDown, MessageSquarePlus } from 'lucide-react'
import { memo } from 'react'
import { NAV_ITEMS } from '../../constants'
import { hermesClient } from '../../lib/hermes-client'
import type { Screen, Session } from '../../types'
import { Logo } from '../ui/Logo'
import { StatusPill } from '../ui/StatusPill'

const SessionRow = memo(function SessionRow({
  session,
  active,
  onSelect
}: {
  session: Session
  active: boolean
  onSelect: (session: Session) => void
}) {
  return (
    <button className={`session-row ${active ? 'session-row--active' : ''}`} onClick={() => onSelect(session)}>
      <span className="session-row__title">{session.title || 'שיחה ללא כותרת'}</span>
      <span className="session-row__preview">{session.preview || 'אין תצוגה מקדימה'}</span>
      <span className="session-row__meta">
        {session.source === 'telegram' ? 'Telegram · ' : ''}
        לאחרונה
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
  taskCount
}: {
  screen: Screen
  setScreen: (screen: Screen) => void
  sessions: Session[]
  activeSession: string
  onSelectSession: (session: Session) => void
  onNewSession: () => void
  runtime: HermesRuntime | null
  taskCount: number
}) {
  const visibleSessions = sessions.slice(0, 8)

  return (
    <aside className="sidebar sidebar--simple">
      <div className="brand">
        <Logo />
        <div>
          <strong>העוזר לעסק</strong>
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
              {item.id === 'tasks' && taskCount > 0 ? <span className="nav-count">{taskCount}</span> : null}
            </button>
          )
        })}
      </nav>

      {visibleSessions.length ? (
        <>
          <div className="sidebar__divider" />
          <div className="sessions-title sessions-title--simple"><span>שיחות אחרונות</span></div>
          <div className="session-list">
            {visibleSessions.map(session => (
              <SessionRow
                key={session.id}
                session={session}
                active={screen === 'chat' && activeSession === session.id}
                onSelect={onSelectSession}
              />
            ))}
          </div>
        </>
      ) : null}

      <div className="sidebar__footer">
        <StatusPill runtime={runtime} demo={hermesClient.demo} />
        <button className="profile-button">
          <span className="avatar">ע</span>
          <span><strong>העסק שלך</strong><small>הידע נשמר ב־Hermes</small></span>
          <ChevronDown size={16} />
        </button>
      </div>
    </aside>
  )
}
