// @vitest-environment jsdom
import '../../test/setup-dom'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatScreen } from './ChatScreen'
import type { Activity, ChatMessage } from '../../types'

// Regression coverage for three confirmed defects: suggestion chips used to send
// immediately instead of populating the composer, the composer textarea went
// disabled (and lost focus) while busy, and Enter during IME composition could
// submit mid-composition. Also covers the new conversation live region, which
// must announce state transitions (working/finished/activity) without
// re-announcing on every streamed delta.

// jsdom does not implement scrollIntoView; ChatScreen calls it on every
// conversation update to keep the latest turn in view.
Element.prototype.scrollIntoView = vi.fn()

function noop() {
  return Promise.resolve(true)
}

function renderChat(overrides: Partial<Parameters<typeof ChatScreen>[0]> = {}) {
  const props = {
    messages: [] as ChatMessage[],
    activities: [] as Activity[],
    approval: null,
    clarify: null,
    busy: false,
    onSend: vi.fn(noop),
    onStop: vi.fn(),
    onApproval: vi.fn(),
    onClarify: vi.fn(),
    ...overrides
  }
  return { ...props, ...render(<ChatScreen {...props} />) }
}

describe('ChatScreen — suggestion chips', () => {
  it('clicking a suggestion populates the composer instead of sending it', async () => {
    const user = userEvent.setup()
    const { onSend } = renderChat()
    await user.click(screen.getByRole('button', { name: 'נסח תשובה ללקוח' }))

    const textarea = screen.getByRole('textbox', { name: 'הודעה לעוזר' })
    expect(textarea).toHaveValue('נסח תשובה ללקוח')
    expect(textarea).toHaveFocus()
    expect(onSend).not.toHaveBeenCalled()
  })

  it('the populated suggestion can still be edited before sending', async () => {
    const user = userEvent.setup()
    const { onSend } = renderChat()
    await user.click(screen.getByRole('button', { name: 'מצא משימה שחוזרת על עצמה' }))
    const textarea = screen.getByRole('textbox', { name: 'הודעה לעוזר' })
    await user.type(textarea, ' דחוף')
    expect(textarea).toHaveValue('מצא משימה שחוזרת על עצמה דחוף')
    expect(onSend).not.toHaveBeenCalled()
  })
})

describe('ChatScreen — composer stays alive while busy', () => {
  it('the textarea is never disabled while busy', () => {
    renderChat({ busy: true })
    expect(screen.getByRole('textbox', { name: 'הודעה לעוזר' })).toBeEnabled()
  })

  it('Enter while busy does not send and does not drop the typed text', async () => {
    const user = userEvent.setup()
    const { onSend } = renderChat({ busy: true, messages: [{ id: 'm1', role: 'user', text: 'שלום' }] })
    const textarea = screen.getByRole('textbox', { name: 'הודעה לעוזר' })
    await user.type(textarea, 'עוד הודעה')
    await user.keyboard('{Enter}')
    expect(onSend).not.toHaveBeenCalled()
    // Not prevented while busy — Enter behaves like a normal newline, so the
    // draft is preserved rather than silently swallowed.
    expect(textarea).toHaveValue('עוד הודעה\n')
  })

  it('Enter mid IME composition does not submit', async () => {
    const onSend = vi.fn(noop)
    renderChat({ onSend })
    const textarea = screen.getByRole('textbox', { name: 'הודעה לעוזר' }) as HTMLTextAreaElement
    await userEvent.setup().type(textarea, 'שלום')
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('a plain Enter (not composing, not busy) still submits', async () => {
    const onSend = vi.fn(noop)
    renderChat({ onSend })
    const textarea = screen.getByRole('textbox', { name: 'הודעה לעוזר' })
    await userEvent.setup().type(textarea, 'שלום{Enter}')
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('שלום', []))
  })
})

describe('ChatScreen — conversation live region', () => {
  it('renders an empty polite status region with no turn in flight', () => {
    renderChat()
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('announces that the assistant is working once busy turns true', () => {
    const { rerender } = render(
      <ChatScreen
        messages={[]}
        activities={[]}
        approval={null}
        clarify={null}
        busy={false}
        onSend={vi.fn(noop)}
        onStop={vi.fn()}
        onApproval={vi.fn()}
        onClarify={vi.fn()}
      />
    )
    rerender(
      <ChatScreen
        messages={[]}
        activities={[]}
        approval={null}
        clarify={null}
        busy
        onSend={vi.fn(noop)}
        onStop={vi.fn()}
        onApproval={vi.fn()}
        onClarify={vi.fn()}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('העוזר עובד על התשובה')
  })

  it('does not re-announce on every streamed delta while busy is unchanged', () => {
    const base = {
      activities: [] as Activity[],
      approval: null,
      clarify: null,
      onSend: vi.fn(noop),
      onStop: vi.fn(),
      onApproval: vi.fn(),
      onClarify: vi.fn()
    }
    const { rerender } = render(
      <ChatScreen {...base} busy messages={[{ id: 'a', role: 'assistant', text: '', streaming: true }]} />
    )
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('העוזר עובד על התשובה')

    rerender(<ChatScreen {...base} busy messages={[{ id: 'a', role: 'assistant', text: 'שלום', streaming: true }]} />)
    // Still busy, still streaming — the announcement must not have flipped to the
    // partial in-progress text.
    expect(status).toHaveTextContent('העוזר עובד על התשובה')
  })

  it('announces the finished answer once the turn completes', () => {
    const base = {
      activities: [] as Activity[],
      approval: null,
      clarify: null,
      onSend: vi.fn(noop),
      onStop: vi.fn(),
      onApproval: vi.fn(),
      onClarify: vi.fn()
    }
    const { rerender } = render(
      <ChatScreen {...base} busy messages={[{ id: 'a', role: 'assistant', text: '', streaming: true }]} />
    )
    rerender(
      <ChatScreen
        {...base}
        busy={false}
        messages={[{ id: 'a', role: 'assistant', text: 'הנה התשובה', streaming: false }]}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('התשובה מוכנה. הנה התשובה')
  })

  it('announces a running tool activity by its label', () => {
    const base = {
      messages: [] as ChatMessage[],
      approval: null,
      clarify: null,
      onSend: vi.fn(noop),
      onStop: vi.fn(),
      onApproval: vi.fn(),
      onClarify: vi.fn()
    }
    render(
      <ChatScreen
        {...base}
        busy
        activities={[
          { id: 'tool-1', tool: 'gmail_search', label: 'מחפש הודעות ב־Gmail', status: 'running', timelineOrder: 1 }
        ]}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('מחפש הודעות ב־Gmail')
  })
})
