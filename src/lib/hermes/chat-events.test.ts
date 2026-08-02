import { describe, expect, it } from 'vitest'
import { handleGatewayEvent } from './chat-events'
import type { Activity, Approval, ChatMessage, ClarifyRequest, GatewayEvent } from '../../types'

// Minimal React-setState harness: applies functional or plain updates against a
// mutable state bag so we can drive the pure reducer without rendering.
function harness(runtimeSession = 's1') {
  const state = {
    busy: false,
    messages: [] as ChatMessage[],
    activities: [] as Activity[],
    approval: null as Approval | null,
    clarify: null as ClarifyRequest | null,
    toast: ''
  }
  const set =
    <K extends keyof typeof state>(key: K) =>
    (value: unknown) => {
      state[key] = (typeof value === 'function' ? (value as (p: unknown) => unknown)(state[key]) : value) as never
    }
  const setters = {
    setBusy: set('busy'),
    setMessages: set('messages'),
    setActivities: set('activities'),
    setApproval: set('approval'),
    setClarify: set('clarify'),
    setToast: (t: string) => {
      state.toast = t
    }
  }
  return {
    state,
    emit: (event: GatewayEvent) => handleGatewayEvent(event, runtimeSession, setters as never)
  }
}

describe('handleGatewayEvent', () => {
  it('ignores events addressed to a different runtime session', () => {
    const h = harness('s1')
    h.emit({ type: 'message.start', session_id: 'other', payload: {} })
    expect(h.state.busy).toBe(false)
    expect(h.state.messages).toHaveLength(0)
  })

  it('streams an assistant message start -> delta -> complete', () => {
    const h = harness('s1')
    h.emit({ type: 'message.start', session_id: 's1', payload: {} })
    expect(h.state.busy).toBe(true)
    expect(h.state.messages[0]).toMatchObject({ role: 'assistant', streaming: true, text: '' })

    h.emit({ type: 'message.delta', session_id: 's1', payload: { text: 'שלום ' } })
    h.emit({ type: 'message.delta', session_id: 's1', payload: { text: 'עולם' } })
    expect(h.state.messages[0].text).toBe('שלום עולם')

    h.emit({ type: 'message.complete', session_id: 's1', payload: { text: 'שלום עולם' } })
    expect(h.state.busy).toBe(false)
    expect(h.state.messages[0]).toMatchObject({ streaming: false, text: 'שלום עולם' })
    expect(h.state.messages[0].time).toBeTruthy()
  })

  it('keeps streaming after a clarification answer is inserted into the same turn', () => {
    const h = harness('s1')
    h.emit({ type: 'message.start', session_id: 's1', payload: {} })
    h.state.messages.push({ id: 'clarify-answer', role: 'user', text: 'Gmail / Google Workspace' })

    h.emit({ type: 'message.delta', session_id: 's1', payload: { text: 'כדי לחבר את Gmail' } })
    h.emit({ type: 'message.complete', session_id: 's1', payload: { text: 'כדי לחבר את Gmail צריך...' } })

    expect(h.state.messages.map(message => message.role)).toEqual(['user', 'assistant'])
    expect(h.state.messages[1]).toMatchObject({
      role: 'assistant',
      streaming: false,
      text: 'כדי לחבר את Gmail צריך...'
    })
  })

  it('creates the final assistant bubble when message.start was missed', () => {
    const h = harness('s1')
    h.state.messages.push({ id: 'user', role: 'user', text: 'שלום' })

    h.emit({ type: 'message.complete', session_id: 's1', payload: { text: 'היי!' } })

    expect(h.state.messages[1]).toMatchObject({ role: 'assistant', text: 'היי!', streaming: false })
    expect(h.state.busy).toBe(false)
  })

  it('seals interim assistant text and continues the turn in a fresh bubble', () => {
    const h = harness('s1')
    h.emit({ type: 'message.start', session_id: 's1', payload: {} })
    h.emit({ type: 'message.delta', session_id: 's1', payload: { text: 'אני בודק.' } })
    h.emit({ type: 'message.interim', session_id: 's1', payload: { text: 'אני בודק.', already_streamed: true } })
    h.emit({ type: 'message.complete', session_id: 's1', payload: { text: 'מצאתי תשובה.' } })

    expect(h.state.messages).toHaveLength(2)
    expect(h.state.messages[0]).toMatchObject({ text: 'אני בודק.', streaming: false })
    expect(h.state.messages[1]).toMatchObject({ text: 'מצאתי תשובה.', streaming: false })
  })

  it('does not duplicate an interim response that message.complete marks as previewed', () => {
    const h = harness('s1')
    h.emit({ type: 'message.start', session_id: 's1', payload: {} })
    h.emit({ type: 'message.interim', session_id: 's1', payload: { text: 'אותה תשובה' } })
    h.emit({
      type: 'message.complete',
      session_id: 's1',
      payload: { text: 'אותה תשובה', response_previewed: true }
    })

    expect(h.state.messages).toHaveLength(1)
    expect(h.state.messages[0]).toMatchObject({ text: 'אותה תשובה', streaming: false })
  })

  it('tracks tool.start and resolves it on tool.complete', () => {
    const h = harness('s1')
    h.emit({ type: 'tool.start', session_id: 's1', payload: { tool_id: 't1', name: 'gmail_search' } })
    expect(h.state.activities[0]).toMatchObject({ id: 't1', status: 'running' })

    h.emit({ type: 'tool.complete', session_id: 's1', payload: { tool_id: 't1', summary: 'נמצאו 3' } })
    expect(h.state.activities[0]).toMatchObject({ id: 't1', status: 'done', detail: 'נמצאו 3' })
  })

  it('collapses repeated status.update entries into a single status row', () => {
    const h = harness('s1')
    h.emit({ type: 'status.update', session_id: 's1', payload: { text: 'חושב...' } })
    h.emit({ type: 'status.update', session_id: 's1', payload: { text: 'מחפש...' } })
    const statuses = h.state.activities.filter(item => item.id.startsWith('status-'))
    expect(statuses).toHaveLength(1)
    expect(statuses[0].label).toBe('מחפש...')
  })

  it('raises an approval request with command and choices', () => {
    const h = harness('s1')
    h.emit({
      type: 'approval.request',
      session_id: 's1',
      payload: { command: 'gmail send', choices: ['once', 'deny'] }
    })
    expect(h.state.approval).toMatchObject({ sessionId: 's1', command: 'gmail send', choices: ['once', 'deny'] })
  })

  it('raises then expires a clarify request by id', () => {
    const h = harness('s1')
    h.emit({
      type: 'clarify.request',
      session_id: 's1',
      payload: { request_id: 'c1', question: 'לאיזה לקוח?', choices: ['א', 'ב'], multi_select: true }
    })
    expect(h.state.clarify).toMatchObject({ requestId: 'c1', question: 'לאיזה לקוח?', multiSelect: true })

    h.emit({ type: 'clarify.expire', session_id: 's1', payload: { request_id: 'other' } })
    expect(h.state.clarify).not.toBeNull()
    h.emit({ type: 'clarify.expire', session_id: 's1', payload: { request_id: 'c1' } })
    expect(h.state.clarify).toBeNull()
  })

  it('surfaces an error as a toast and clears busy', () => {
    const h = harness('s1')
    h.emit({ type: 'message.start', session_id: 's1', payload: {} })
    h.emit({ type: 'error', session_id: 's1', payload: { message: 'משהו השתבש' } })
    expect(h.state.busy).toBe(false)
    expect(h.state.toast).toBe('משהו השתבש')
  })
})
