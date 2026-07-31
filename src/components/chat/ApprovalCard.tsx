import { Check, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import type { Approval } from '../../types'

export function ApprovalCard({
  approval,
  onRespond
}: {
  approval: Approval
  onRespond: (choice: 'once' | 'deny') => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="approval-card">
      <div className="approval-card__icon">
        <ShieldCheck size={20} />
      </div>
      <div className="approval-card__body">
        <strong>{approval.title}</strong>
        <p>{approval.description}</p>
        {expanded && approval.command ? <pre>{approval.command}</pre> : null}
        <div className="approval-card__actions">
          <button className="primary-button primary-button--small" onClick={() => onRespond('once')}>
            <Check size={15} /> אשר פעם אחת
          </button>
          <button className="ghost-button ghost-button--danger" onClick={() => onRespond('deny')}>
            דחה
          </button>
          {approval.command ? (
            <button className="link-button" onClick={() => setExpanded(value => !value)}>
              {expanded ? 'הסתר פרטים' : 'הצג פרטים'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
