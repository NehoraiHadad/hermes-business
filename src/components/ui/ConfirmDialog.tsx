import { Modal } from './Modal'

// Reusable confirm-before-action dialog built on the house Modal (focus trap,
// initial focus, Escape-to-cancel, backdrop click — see Modal.tsx/
// Modal.test.tsx). Exists so consequential actions (running a task for real,
// deleting one permanently — TasksScreen.tsx) get a styled, RTL,
// non-blocking dialog instead of the OS-chrome, LTR, renderer-blocking
// `window.confirm()`.
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'ביטול',
  // Marks an irreversible/destructive action (e.g. permanent delete) so the
  // confirm button reads visually AND semantically distinct from a neutral
  // confirm — never the same look as "run now" or "save".
  destructive = false,
  onConfirm,
  onCancel
}: {
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="confirm-dialog">
        <p className="confirm-dialog__message">{message}</p>
        <div className="modal__actions">
          <button type="button" className="ghost-button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={destructive ? 'confirm-dialog__confirm confirm-dialog__confirm--danger' : 'primary-button'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
