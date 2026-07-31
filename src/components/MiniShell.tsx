import { CheckCircle2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { MiniHeader } from './layout/MiniHeader'

// The mini companion surface: compact header, the shared chat screen and a small
// toast. Rendered when the assistant window is in mini mode.
export function MiniShell({
  runtime,
  pinned,
  toast,
  chatScreen,
  onNewSession,
  onTogglePin,
  onExpand,
  onHide
}: {
  runtime: HermesRuntime | null
  pinned: boolean
  toast: string
  chatScreen: ReactNode
  onNewSession: () => void
  onTogglePin: () => void
  onExpand: () => void
  onHide: () => void
}) {
  return (
    <div className="mini-shell" dir="rtl">
      <MiniHeader
        runtime={runtime}
        pinned={pinned}
        onNewSession={onNewSession}
        onTogglePin={onTogglePin}
        onExpand={onExpand}
        onHide={onHide}
      />
      {chatScreen}
      <div className="mini-powered">מופעל באמצעות Hermes</div>
      {toast ? (
        <div className="floating-toast floating-toast--mini">
          <CheckCircle2 size={15} /> {toast}
        </div>
      ) : null}
    </div>
  )
}
