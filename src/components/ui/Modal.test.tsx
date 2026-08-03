// @vitest-environment jsdom
import '../../test/setup-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { Modal } from './Modal'

// P1 exemplar (docs/specs/component-tests.md §6, "P1"). Modal has no
// dependency on the hermesDesktop bridge — it proves the DOM test
// infrastructure in its purest form: focus management, keyboard handling and
// dialog semantics, all pure DOM/React behavior.

// The real Modal always renders its own close button, so "no focusable
// element inside the dialog" never happens through props alone. That branch
// ((focusable[0] || node)?.focus() in Modal.tsx) is still real code that must
// stay correct, so this partial mock of the pure focus-trap query lets one
// test force the empty-list precondition while every other test keeps the
// real queryFocusable/nextFocusIndex implementation.
const { getFocusableOverride, setFocusableOverride } = vi.hoisted(() => {
  let override: ((container: HTMLElement) => HTMLElement[]) | null = null
  return {
    getFocusableOverride: () => override,
    setFocusableOverride: (fn: ((container: HTMLElement) => HTMLElement[]) | null) => {
      override = fn
    }
  }
})

vi.mock('../../lib/focus-trap', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/focus-trap')>()
  return {
    ...actual,
    queryFocusable: (container: HTMLElement) => {
      const override = getFocusableOverride()
      return override ? override(container) : actual.queryFocusable(container)
    }
  }
})

afterEach(() => {
  setFocusableOverride(null)
})

function renderModal(children: ReactNode = <p>תוכן</p>, onClose = vi.fn()) {
  return { onClose, ...render(<Modal title="כותרת בדיקה" onClose={onClose}>{children}</Modal>) }
}

function renderWithFocusables(onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <Modal title="כותרת בדיקה" onClose={onClose}>
        <button>ראשון</button>
        <button>שני</button>
      </Modal>
    )
  }
}

describe('Modal focus management', () => {
  it('moves focus to the first focusable element on mount', () => {
    renderModal()
    expect(screen.getByRole('button', { name: 'סגור' })).toHaveFocus()
  })

  it('focuses the dialog surface itself when nothing inside it is focusable', () => {
    setFocusableOverride(() => [])
    renderModal()
    expect(screen.getByRole('dialog', { name: 'כותרת בדיקה' })).toHaveFocus()
  })

  it('restores focus to the previously focused element on unmount', () => {
    render(<button>פותח</button>)
    const trigger = screen.getByRole('button', { name: 'פותח' })
    trigger.focus()
    expect(trigger).toHaveFocus()

    const { unmount } = render(
      <Modal title="כותרת בדיקה" onClose={vi.fn()}>
        <p>תוכן</p>
      </Modal>
    )
    expect(screen.getByRole('button', { name: 'סגור' })).toHaveFocus()

    unmount()
    expect(trigger).toHaveFocus()
  })

  it('does not throw restoring focus when the previously focused element is gone (document.contains guard)', () => {
    const { unmount: unmountTrigger } = render(<button>פותח זמני</button>)
    const trigger = screen.getByRole('button', { name: 'פותח זמני' })
    trigger.focus()
    unmountTrigger()

    const { unmount } = render(
      <Modal title="כותרת בדיקה" onClose={vi.fn()}>
        <p>תוכן</p>
      </Modal>
    )
    expect(() => unmount()).not.toThrow()
  })
})

describe('Modal keyboard handling', () => {
  it('Escape calls onClose', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal(<button>פנימי</button>)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Tab cycles forward through the dialog focusables and wraps at the end', async () => {
    const user = userEvent.setup()
    renderWithFocusables()
    const close = screen.getByRole('button', { name: 'סגור' })
    const first = screen.getByRole('button', { name: 'ראשון' })
    const second = screen.getByRole('button', { name: 'שני' })
    expect(close).toHaveFocus()

    await user.tab()
    expect(first).toHaveFocus()
    await user.tab()
    expect(second).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus() // wraps back to the start
  })

  it('Shift+Tab cycles backward through the dialog focusables and wraps at the start', async () => {
    const user = userEvent.setup()
    renderWithFocusables()
    const close = screen.getByRole('button', { name: 'סגור' })
    const second = screen.getByRole('button', { name: 'שני' })
    expect(close).toHaveFocus()

    await user.tab({ shift: true })
    expect(second).toHaveFocus() // wraps back to the end
  })
})

describe('Modal backdrop behavior', () => {
  it('mousedown on the backdrop closes the dialog', () => {
    const { onClose } = renderModal()
    const backdrop = document.querySelector('.modal-backdrop') as HTMLElement
    fireEvent.mouseDown(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('mousedown inside the dialog content does not close it', () => {
    const { onClose } = renderModal(<button>תוכן</button>)
    fireEvent.mouseDown(screen.getByRole('button', { name: 'תוכן' }))
    fireEvent.mouseDown(screen.getByRole('dialog', { name: 'כותרת בדיקה' }))
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('Modal semantics', () => {
  it('exposes role=dialog, aria-modal=true, aria-label=title and a "סגור" close button', () => {
    renderModal()
    const dialog = screen.getByRole('dialog', { name: 'כותרת בדיקה' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'סגור' })).toBeInTheDocument()
  })

  it('clicking the close button calls onClose', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal()
    await user.click(screen.getByRole('button', { name: 'סגור' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
