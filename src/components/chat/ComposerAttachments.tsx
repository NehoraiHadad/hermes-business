import { FileText, Image as ImageIcon, X } from 'lucide-react'
import type { PendingAttachment } from '../../lib/hermes/attachments'

// Pending/sent attachment chips shown above the composer input. Each chip can be
// removed before sending; a failed send marks its chips so the user can retry.
export function ComposerAttachments({
  attachments,
  onRemove
}: {
  attachments: PendingAttachment[]
  onRemove: (id: string) => void
}) {
  if (!attachments.length) return null
  return (
    <div className="composer-attachments">
      {attachments.map(item => (
        <div
          key={item.id}
          className={`composer-chip${item.status === 'error' ? ' composer-chip--error' : ''}`}
          title={item.error || item.name}
        >
          {item.kind === 'image' ? <ImageIcon size={15} /> : <FileText size={15} />}
          <span>{item.name}</span>
          <button
            type="button"
            className="composer-chip__remove"
            aria-label={`הסר את ${item.name}`}
            onClick={() => onRemove(item.id)}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
