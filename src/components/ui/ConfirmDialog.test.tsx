// @vitest-environment jsdom
import '../../test/setup-dom'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from './ConfirmDialog'

// ConfirmDialog is a thin wrapper over Modal (P1 exemplar, Modal.test.tsx) —
// focus-trap/Escape/backdrop behavior is already proven there. This suite
// only covers what ConfirmDialog itself adds: rendering the message, wiring
// confirm/cancel, and the destructive/neutral visual+semantic distinction
// (TasksScreen.tsx's trigger-now vs. permanent-delete confirmations).

describe('ConfirmDialog', () => {
  it('renders the title and message and calls onConfirm when the confirm button is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        title="הרצה עכשיו"
        message='להריץ עכשיו את "גיבוי יומי"? Hermes יבצע את המשימה מיד.'
        confirmLabel="הרץ עכשיו"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    expect(screen.getByRole('dialog', { name: 'הרצה עכשיו' })).toBeInTheDocument()
    expect(screen.getByText('להריץ עכשיו את "גיבוי יומי"? Hermes יבצע את המשימה מיד.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'הרץ עכשיו' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('calls onCancel when the cancel button is clicked, and defaults its label to "ביטול"', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog title="מחיקת משימה" message="פעולה זו" confirmLabel="מחיקה" onConfirm={vi.fn()} onCancel={onCancel} />
    )
    const cancelButton = screen.getByRole('button', { name: 'ביטול' })
    await user.click(cancelButton)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel on Escape (inherited Modal behavior)', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog title="מחיקת משימה" message="פעולה זו" confirmLabel="מחיקה" onConfirm={vi.fn()} onCancel={onCancel} />
    )
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('a non-destructive confirm button uses the neutral primary-button style', () => {
    render(
      <ConfirmDialog title="הרצה עכשיו" message="פעולה זו" confirmLabel="הרץ עכשיו" onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    const confirmButton = screen.getByRole('button', { name: 'הרץ עכשיו' })
    expect(confirmButton.className).toContain('primary-button')
    expect(confirmButton.className).not.toContain('danger')
  })

  it('a destructive confirm button is visually and semantically distinct from the neutral style', () => {
    render(
      <ConfirmDialog
        title="מחיקת משימה"
        message='למחוק לצמיתות את "גיבוי יומי"? לא ניתן לשחזר.'
        confirmLabel="מחיקה לצמיתות"
        destructive
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    const confirmButton = screen.getByRole('button', { name: 'מחיקה לצמיתות' })
    expect(confirmButton.className).toContain('confirm-dialog__confirm--danger')
    expect(confirmButton.className).not.toContain('primary-button')
  })
})
