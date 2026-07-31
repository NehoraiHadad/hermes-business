import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={event => event.target === event.currentTarget && onClose()}
    >
      <section className={`modal ${wide ? 'modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <button className="modal__close icon-button" onClick={onClose}>
          <X size={18} />
        </button>
        <div className="modal__heading">
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {children}
      </section>
    </div>
  )
}
