// @vitest-environment jsdom
import '../../test/setup-dom'
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Approval } from '../../types'
import { ApprovalCard } from './ApprovalCard'

// The approval card is the last gate before the assistant does something real,
// so these tests are about the gate itself: one answer per card, an honest way
// back after a failed answer, and the card being announced/labelled for a user
// who cannot see it appear mid-conversation.

const approval: Approval = {
  id: 'approval-1',
  sessionId: 'session-1',
  title: 'לשלוח מייל לדני?',
  description: 'סיכום הפגישה מוכן לשליחה.',
  command: 'gmail send --to dani@example.com',
  choices: ['once', 'deny']
}

// A response that stays in flight until the test releases it — that window is
// exactly where a double-click used to send the same email twice.
function heldResponse() {
  let release!: (delivered: boolean) => void
  const promise = new Promise<boolean>(resolve => {
    release = resolve
  })
  return { promise, release: (delivered: boolean) => act(async () => release(delivered)) }
}

describe('ApprovalCard answering', () => {
  it('locks both buttons on the first click so a second click cannot answer again', async () => {
    const user = userEvent.setup()
    const held = heldResponse()
    const onRespond = vi.fn(() => held.promise)
    render(<ApprovalCard approval={approval} onRespond={onRespond} />)

    await user.click(screen.getByRole('button', { name: 'אשר ושלח' }))

    const primary = await screen.findByRole('button', { name: 'שולח…' })
    const deny = screen.getByRole('button', { name: 'דחה' })
    expect(primary).toBeDisabled()
    expect(deny).toBeDisabled()

    await user.click(primary)
    await user.click(deny) // deny must not chase an approve that is already on its way
    expect(onRespond).toHaveBeenCalledTimes(1)
    expect(onRespond).toHaveBeenCalledWith('once')

    await held.release(true)
  })

  it('stays locked after the answer landed — the card is spent and about to unmount', async () => {
    const user = userEvent.setup()
    const held = heldResponse()
    render(<ApprovalCard approval={approval} onRespond={() => held.promise} />)

    await user.click(screen.getByRole('button', { name: 'אשר ושלח' }))
    await held.release(true)

    expect(screen.getByRole('button', { name: 'שולח…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'דחה' })).toBeDisabled()
  })

  it('unlocks for a retry when the answer did not land (onRespond resolves false)', async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn(async () => false)
    render(<ApprovalCard approval={approval} onRespond={onRespond} />)

    await user.click(screen.getByRole('button', { name: 'אשר ושלח' }))

    const primary = await screen.findByRole('button', { name: 'אשר ושלח' })
    expect(primary).toBeEnabled()
    expect(screen.getByRole('button', { name: 'דחה' })).toBeEnabled()

    await user.click(primary)
    expect(onRespond).toHaveBeenCalledTimes(2)
  })

  it('unlocks when onRespond rejects, instead of leaving a dead card on screen', async () => {
    const user = userEvent.setup()
    render(<ApprovalCard approval={approval} onRespond={() => Promise.reject<boolean>(new Error('no socket'))} />)

    await user.click(screen.getByRole('button', { name: 'דחה' }))

    expect(await screen.findByRole('button', { name: 'דחה' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'אשר ושלח' })).toBeEnabled()
  })

  it('reports the deny choice as-is', async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn(async () => true)
    render(<ApprovalCard approval={approval} onRespond={onRespond} />)

    await user.click(screen.getByRole('button', { name: 'דחה' }))
    expect(onRespond).toHaveBeenCalledWith('deny')
  })
})

describe('ApprovalCard semantics', () => {
  it('is an announced, labelled group', () => {
    render(<ApprovalCard approval={approval} onRespond={vi.fn()} />)
    const group = screen.getByRole('group', { name: 'לשלוח מייל לדני?' })
    expect(group).toHaveAttribute('aria-live', 'assertive')
    expect(group).toHaveAttribute('aria-atomic', 'true')
  })

  it('keeps the raw command as collapsed technical detail with a wired-up toggle', async () => {
    const user = userEvent.setup()
    render(<ApprovalCard approval={approval} onRespond={vi.fn()} />)

    const toggle = screen.getByRole('button', { name: 'הצג פרטים' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const details = document.getElementById(toggle.getAttribute('aria-controls') as string)
    expect(details).not.toBeNull()
    expect(details).not.toBeVisible()

    await user.click(toggle)
    expect(screen.getByRole('button', { name: 'הסתר פרטים' })).toHaveAttribute('aria-expanded', 'true')
    expect(details).toBeVisible()
    expect(details).toHaveTextContent('פרטים טכניים')
    expect(details?.querySelector('pre')).toHaveTextContent('gmail send --to dani@example.com')
  })

  it('offers no details toggle when there is no command to show', () => {
    render(<ApprovalCard approval={{ ...approval, command: undefined }} onRespond={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'הצג פרטים' })).toBeNull()
  })
})
