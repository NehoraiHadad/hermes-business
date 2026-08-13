// @vitest-environment jsdom
import '../../test/setup-dom'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectionsScreen } from './ConnectionsScreen'
import type { Connection } from '../../types'

// Pins two defects fixed here:
//  1. The screen used to promise "אפשר לנתק כל חיבור בכל רגע" with no disconnect
//     control anywhere (real check: no revoke/disconnect RPC exists in
//     src/lib/hermes-client.ts or the connect modals — hermesClient.disconnect()
//     is the websocket transport teardown, not a per-service revoke). The copy
//     must not claim a control that doesn't exist, and the "מחובר" button must
//     read as something actionable, with an accessible name naming the service.
//  2. Every "חבר" button must be distinguishable by screen reader (per-service
//     accessible name), not a wall of identically-named "חבר" buttons.

function connections(overrides: Partial<Connection>[] = []): Connection[] {
  const base: Connection[] = [
    { id: 'google', name: 'Google Workspace', description: 'מייל, יומן, Drive', state: 'available', official: true, icon: 'google' },
    { id: 'telegram', name: 'Telegram', description: 'דבר עם העוזר גם מהטלפון', state: 'connected', official: true, icon: 'telegram' },
    { id: 'whatsapp', name: 'WhatsApp אישי', description: 'חיבור אישי', state: 'attention', official: false, icon: 'whatsapp' }
  ]
  return base.map((connection, index) => ({ ...connection, ...overrides[index] }))
}

describe('ConnectionsScreen — heading hierarchy', () => {
  it('nests page title (h2) > panel title (h3) > each service name (h4)', () => {
    render(<ConnectionsScreen connections={connections()} onConnect={vi.fn()} />)
    expect(screen.getByRole('heading', { level: 2, name: 'חיבורים' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'חיבורים זמינים' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 4, name: 'Google Workspace' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 4, name: 'Telegram' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 4, name: 'WhatsApp אישי' })).toBeInTheDocument()
  })
})

describe('ConnectionsScreen — accessible, honest controls', () => {
  it('gives every "חבר" button a distinct accessible name naming its service', () => {
    render(<ConnectionsScreen connections={connections()} onConnect={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'חבר את Google Workspace' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'חבר את WhatsApp אישי' })).toBeInTheDocument()
  })

  it('the connected control names the service and explains it opens management, not just "מחובר"', () => {
    render(<ConnectionsScreen connections={connections()} onConnect={vi.fn()} />)
    const managed = screen.getByRole('button', { name: /Telegram.*מחובר.*לנהל את החיבור/ })
    expect(managed).toBeInTheDocument()
  })

  it('clicking the connected control invokes onConnect with that connection, same as "חבר"', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    render(<ConnectionsScreen connections={connections()} onConnect={onConnect} />)
    await user.click(screen.getByRole('button', { name: /Telegram.*מחובר/ }))
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ id: 'telegram' }))
  })

  it('never claims a disconnect control that does not exist', () => {
    render(<ConnectionsScreen connections={connections()} onConnect={vi.fn()} />)
    expect(screen.queryByText(/לנתק/)).not.toBeInTheDocument()
  })

  it('shows the third-party WhatsApp risk warning for the unofficial connection only, ahead of its description', () => {
    render(<ConnectionsScreen connections={connections()} onConnect={vi.fn()} />)
    expect(screen.getByText(/API צד שלישי/)).toBeInTheDocument()
    // Only the unofficial (official: false) row carries the risk note.
    expect(screen.queryAllByText(/API צד שלישי/)).toHaveLength(1)
  })
})
