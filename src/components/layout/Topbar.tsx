import {
  Activity as ActivityIcon,
  Check,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  Minimize2,
  Settings2,
  TerminalSquare
} from 'lucide-react'
import { useState } from 'react'
import { Logo } from '../ui/Logo'

export function Topbar({
  title,
  runtime,
  onOpenFull,
  onMini
}: {
  title: string
  runtime: HermesRuntime | null
  onOpenFull: (surface: 'desktop' | 'dashboard' | 'logs' | 'settings') => void
  onMini: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <header className="topbar">
      <div className="topbar__title">
        <h1>{title}</h1>
        {runtime?.running ? (
          <span className="sync-label">
            <Check size={13} /> הכול מסונכרן
          </span>
        ) : null}
      </div>
      <div className="topbar__actions">
        <button className="outline-button outline-button--small" onClick={onMini}>
          <Minimize2 size={15} />
          צ׳אט קטן
        </button>
        <button className="icon-button" aria-label="עזרה">
          <CircleHelp size={19} />
        </button>
        <div className="full-menu-wrap">
          <button className="outline-button" onClick={() => setOpen(value => !value)}>
            <ExternalLink size={16} />
            כלים מתקדמים
            <ChevronDown size={15} />
          </button>
          {open ? (
            <div className="dropdown-menu">
              <button onClick={() => onOpenFull('desktop')}>
                <Logo small />
                <span>
                  <strong>Hermes Desktop</strong>
                  <small>הממשק המלא</small>
                </span>
              </button>
              <button onClick={() => onOpenFull('dashboard')}>
                <ActivityIcon size={17} />
                <span>
                  <strong>Dashboard</strong>
                  <small>ניהול מתקדם</small>
                </span>
              </button>
              <button onClick={() => onOpenFull('logs')}>
                <TerminalSquare size={17} />
                <span>
                  <strong>Logs</strong>
                  <small>מידע טכני</small>
                </span>
              </button>
              <button onClick={() => onOpenFull('settings')}>
                <Settings2 size={17} />
                <span>
                  <strong>הגדרות מתקדמות</strong>
                  <small>Providers, tools ו־profiles</small>
                </span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
