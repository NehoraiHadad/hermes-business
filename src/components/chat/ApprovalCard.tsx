import { Check, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import type { Approval } from '../../types'

// The last gate before the assistant does something real (sends an email, a
// message). Two invariants live here:
//   1. One answer per card. Both buttons lock on the FIRST click, because a
//      second click would send the same action twice — or send a deny after an
//      approve that is already on its way to Hermes.
//   2. The card only disappears when the answer actually landed. onRespond
//      reports a failed response by resolving to false; anything else means the
//      answer was delivered and this card is about to unmount with it, so we
//      stay locked rather than briefly re-opening a card that is already spent.
export function ApprovalCard({
  approval,
  onRespond
}: {
  approval: Approval
  onRespond: (choice: 'once' | 'deny') => Promise<boolean | void> | void
}) {
  const [expanded, setExpanded] = useState(false)
  const [pending, setPending] = useState<'once' | 'deny' | null>(null)
  const titleId = `approval-title-${approval.id}`
  const detailsId = `approval-details-${approval.id}`

  const respond = async (choice: 'once' | 'deny') => {
    if (pending) return
    setPending(choice)
    try {
      if ((await onRespond(choice)) === false) setPending(null)
    } catch {
      // A caller that rejects instead of reporting false must not leave a dead
      // card on screen — unlock so the user can answer again.
      setPending(null)
    }
  }

  return (
    // The card arrives mid-conversation, so it announces itself; aria-live on a
    // labelled group keeps BOTH the announcement and the grouping, which a bare
    // role="alert" container would give up.
    <div className="approval-card" role="group" aria-labelledby={titleId} aria-live="assertive" aria-atomic="true">
      <div className="approval-card__icon">
        <ShieldCheck size={20} />
      </div>
      <div className="approval-card__body">
        <strong id={titleId}>{approval.title}</strong>
        <p>{approval.description}</p>
        {approval.command ? (
          // Always rendered (just hidden) so aria-controls always points at a
          // real element, even while the details are collapsed.
          <div className="approval-card__details" id={detailsId} hidden={!expanded}>
            <span className="approval-card__details-caption">פרטים טכניים</span>
            <pre>{approval.command}</pre>
          </div>
        ) : null}
        <div className="approval-card__actions">
          <button
            className="primary-button primary-button--small"
            disabled={pending !== null}
            onClick={() => void respond('once')}
          >
            <Check size={15} /> {pending === 'once' ? 'שולח…' : 'אשר ושלח'}
          </button>
          <button
            className="ghost-button ghost-button--danger"
            disabled={pending !== null}
            onClick={() => void respond('deny')}
          >
            דחה
          </button>
          {approval.command ? (
            <button
              className="link-button"
              aria-expanded={expanded}
              aria-controls={detailsId}
              onClick={() => setExpanded(value => !value)}
            >
              {expanded ? 'הסתר פרטים' : 'הצג פרטים'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
