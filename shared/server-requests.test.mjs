import { describe, expect, it } from 'vitest'
import { HermesServerRequests } from './server-requests.js'

function fixture() {
  const sent = [], events = []
  const channel = new HermesServerRequests(frame => sent.push(frame), event => events.push(event))
  const approval = id => ({ id, method: 'approval', params: { session_id: 'session', command: 'test', request_id: 'queue-id' } })
  return { channel, sent, events, approval }
}

describe('native server requests', () => {
  it('advertises support and answers the frame id, preserving the native choice', () => {
    const { channel, sent, events, approval } = fixture()
    channel.advertise()
    expect(sent[0]).toMatchObject({ method: 'client.capabilities', params: { server_requests: true } })
    channel.accept(approval('srq-native'))
    expect(events[0].payload.request_id).toBe('srq-native')
    channel.respond('srq-native', { choice: 'deny' })
    expect(sent[1]).toEqual({ jsonrpc: '2.0', id: 'srq-native', result: { choice: 'deny' } })
    expect(() => channel.respond('srq-native', { choice: 'once' })).toThrow(/no longer open/)
  })

  it('rejects unsupported requests without executing a tool or granting permission', () => {
    const { channel, sent, events } = fixture()
    channel.accept({ id: 'unknown', method: 'terminal.read', params: {} })
    expect(sent[0]).toMatchObject({ id: 'unknown', error: { code: -32601 } })
    expect(events).toEqual([])
  })

  it('restores cards on resume and drops cancelled or disconnected requests', () => {
    const { channel, events, approval } = fixture()
    channel.accept(approval('srq-one'))
    channel.replay({ open_requests: [approval('srq-one')] })
    expect(events).toHaveLength(2)
    expect(events.at(-1).payload.request_id).toBe('srq-one')
    channel.cancel({ id: 'srq-one', reason: 'expired' })
    expect(events.at(-1)).toMatchObject({ type: 'request.cancel', payload: { id: 'srq-one' } })
    expect(() => channel.respond('srq-one', { choice: 'once' })).toThrow()
    channel.replay({ open_requests: [approval('srq-two')] })
    channel.reset()
    expect(() => channel.respond('srq-two', { choice: 'once' })).toThrow()
  })

  it('promotes a queued approval after the first is answered', () => {
    const { channel, events, approval } = fixture()
    channel.accept(approval('srq-one'))
    channel.accept(approval('srq-two'))
    expect(events).toHaveLength(1)
    channel.respond('srq-one', { choice: 'deny' })
    expect(events.at(-1).payload.request_id).toBe('srq-two')
  })

  it('collects every clarification answer and preserves server-locked answers', () => {
    const { channel, events, sent } = fixture()
    channel.accept({ id: 'srq-batch', method: 'clarify', params: {
      session_id: 'session', answers: { a: 'already locked' }, questions: [
        { qid: 'a', question: 'First' }, { qid: 'b', question: 'Second' }, { qid: 'c', question: 'Third', multi_select: true }
      ]
    } })
    expect(events.at(-1).payload.question).toBe('Second')
    channel.respond('srq-batch:b', { answer: 'answer two' })
    expect(sent).toEqual([])
    expect(events.at(-1).payload.question).toBe('Third')
    channel.respond('srq-batch:c', { answer: 'answer three' })
    expect(sent[0]).toMatchObject({ id: 'srq-batch', result: { answers: { a: 'already locked', b: 'answer two', c: 'answer three' } } })
  })

  it('keeps a failed write retryable', () => {
    const { approval } = fixture()
    let fail = true
    const channel = new HermesServerRequests(() => { if (fail) throw new Error('socket closed') }, () => {})
    channel.accept(approval('srq-one'))
    expect(() => channel.respond('srq-one', { choice: 'deny' })).toThrow('socket closed')
    fail = false
    expect(() => channel.respond('srq-one', { choice: 'deny' })).not.toThrow()
  })
})
