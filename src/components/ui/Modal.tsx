import { X } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react'
import { nextFocusIndex, queryFocusable } from '../../lib/focus-trap'

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
  const dialogRef = useRef<HTMLElement>(null)

  // Initial focus + focus restore. Move focus into the dialog as soon as it
  // mounts (first focusable element, or the dialog surface itself via its
  // tabIndex={-1} when it has none), then hand focus back to whatever the user
  // was on before it opened once it unmounts — a keyboard/screen-reader user
  // must never lose their place in the page behind the dialog.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const node = dialogRef.current
    const focusable = node ? queryFocusable(node) : []
    ;(focusable[0] || node)?.focus()
    return () => {
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus()
    }
  }, [])

  // Escape closes (same path as the close button / backdrop click) and Tab /
  // Shift+Tab cycle within the dialog only — a dependency-free focus trap. The
  // cycling decision itself is the pure, tested `nextFocusIndex`; this handler
  // is just the DOM plumbing around it.
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      onClose()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = queryFocusable(dialogRef.current)
    if (focusable.length === 0) {
      event.preventDefault()
      dialogRef.current.focus()
      return
    }
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement)
    const index = nextFocusIndex(focusable.length, currentIndex, event.shiftKey)
    event.preventDefault()
    focusable[index]?.focus()
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={event => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={dialogRef}
        className={`modal ${wide ? 'modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <button className="modal__close icon-button" aria-label="סגור" onClick={onClose}>
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
