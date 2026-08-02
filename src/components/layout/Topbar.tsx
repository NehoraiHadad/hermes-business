import {
  Activity as ActivityIcon,
  Check,
  CircleHelp,
  ExternalLink,
  FolderCog,
  Minimize2,
  PlugZap,
  Settings2,
  TerminalSquare
} from 'lucide-react'
import { useState } from 'react'
import type { Screen } from '../../types'
import { Logo } from '../ui/Logo'

export function Topbar({
  title,
  runtime,
  onOpenFull,
  onNavigate,
  onMini
}: {
  title: string
  runtime: HermesRuntime | null
  onOpenFull: (surface: 'desktop' | 'dashboard' | 'logs' | 'settings') => void
  onNavigate: (screen: Screen) => void
  onMini: () => void
}) {
  const [open, setOpen] = useState(false)
  const navigate = (screen: Screen) => {
    onNavigate(screen)
    setOpen(false)
  }

  return (
    <header className="topbar">
      <div className="topbar__title">
        <h1>{title}</h1>
        {runtime?.running ? (
          <span className="sync-label">
            <Check size={13} /> מוכן לעבודה
          </span>
        ) : null}
      </div>
      <div className="topbar__actions">
        <button className="outline-button outline-button--small" onClick={onMini}>
          <Minimize2 size={15} />
          חלון קטן
        </button>
        <div className="full-menu-wrap">
          <button
            className="icon-button"
            aria-label="הגדרות ועזרה"
            aria-expanded={open}
            onClick={() => setOpen(value => !value)}
          >
            <Settings2 size={19} />
          </button>
          {open ? (
            <div className="dropdown-menu settings-menu">
              <button onClick={() => navigate('connections')}>
                <PlugZap size={17} />
                <span><strong>חיבורים</strong><small>כלים שכבר מחוברים לעוזר</small></span>
              </button>
              <button onClick={() => navigate('support')}>
                <CircleHelp size={17} />
                <span><strong>עזרה ותמיכה</strong><small>בדיקה פשוטה ושליחת אבחון</small></span>
              </button>
              <div className="dropdown-menu__section">כלים טכניים</div>
              <button onClick={() => onOpenFull('desktop')}>
                <Logo small />
                <span><strong>Hermes Desktop</strong><small>הממשק המלא למשתמשים מתקדמים</small></span>
              </button>
              <button onClick={() => onOpenFull('dashboard')}>
                <ActivityIcon size={17} />
                <span><strong>Dashboard</strong><small>ניהול ואבחון מתקדם</small></span>
              </button>
              <button onClick={() => onOpenFull('logs')}>
                <TerminalSquare size={17} />
                <span><strong>Logs</strong><small>קובצי מערכת לתמיכה</small></span>
              </button>
              <button onClick={() => onOpenFull('settings')}>
                <FolderCog size={17} />
                <span><strong>הגדרות Hermes</strong><small>Providers, tools ו־profiles</small></span>
                <ExternalLink size={13} />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
