import { Maximize2, MessageCircle, MessageSquarePlus, Minimize2, Pin, PinOff } from 'lucide-react'

export function MiniHeader({
  runtime,
  pinned,
  onNewSession,
  onTogglePin,
  onExpand,
  onHide
}: {
  runtime: HermesRuntime | null
  pinned: boolean
  onNewSession: () => void
  onTogglePin: () => void
  onExpand: () => void
  onHide: () => void
}) {
  return (
    <header className="mini-header">
      <div className="mini-header__identity">
        <span className="mini-avatar">
          <MessageCircle size={17} />
        </span>
        <span>
          <strong>העוזר שלי</strong>
          <small className={runtime?.running ? 'mini-status mini-status--online' : 'mini-status'}>
            {runtime?.running ? 'מוכן לעזור' : runtime?.starting ? 'מתכונן…' : 'לא זמין כרגע'}
          </small>
        </span>
      </div>
      <div className="mini-header__actions">
        <button onClick={onNewSession} aria-label="שיחה חדשה" title="שיחה חדשה">
          <MessageSquarePlus size={17} />
        </button>
        <button
          className={pinned ? 'mini-action--active' : ''}
          onClick={onTogglePin}
          aria-label={pinned ? 'בטל הצמדה מעל חלונות' : 'הצמד מעל חלונות'}
          title={pinned ? 'מוצמד מעל חלונות' : 'הצמד מעל חלונות'}
        >
          {pinned ? <Pin size={16} /> : <PinOff size={16} />}
        </button>
        <button onClick={onExpand} aria-label="פתח חלון מלא" title="פתח חלון מלא">
          <Maximize2 size={16} />
        </button>
        <button onClick={onHide} aria-label="הסתר את העוזר" title="הסתר">
          <Minimize2 size={16} />
        </button>
      </div>
    </header>
  )
}
