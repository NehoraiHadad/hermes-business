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
  onMini,
  hasUpdateIndicator = false
}: {
  title: string
  runtime: HermesRuntime | null
  onOpenFull: (surface: 'desktop' | 'dashboard' | 'logs' | 'settings') => void
  onNavigate: (screen: Screen) => void
  onMini: () => void
  // Passive companion-update surface (docs/specs/versioning.md §7.2): a dot — not a
  // count, unlike the Sidebar's .nav-badge unseen-activity counter — shown on the
  // gear icon and the "עזרה ותמיכה" row once FullAppShell has seen a pushed
  // update-available verdict the owner hasn't dismissed yet (by opening support).
  hasUpdateIndicator?: boolean
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
            aria-label={hasUpdateIndicator ? 'הגדרות ועזרה — עדכון חדש זמין' : 'הגדרות ועזרה'}
            aria-expanded={open}
            onClick={() => setOpen(value => !value)}
          >
            <Settings2 size={19} />
            {hasUpdateIndicator ? <span className="icon-button__update-dot" aria-hidden="true" /> : null}
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
                {hasUpdateIndicator ? <span className="dropdown-menu__update-dot" aria-hidden="true" /> : null}
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
