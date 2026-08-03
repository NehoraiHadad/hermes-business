import { describe, expect, it } from 'vitest'
import { createReconnectResumeTracker } from './chat-resume'
import type { ConnectionState } from './transport'

// Replays a connection-state sequence and reports which states demanded a resume.
function replay(states: ConnectionState[]): ConnectionState[] {
  const tracker = createReconnectResumeTracker()
  return states.filter(state => tracker.observe(state))
}

describe('reconnect resume tracker', () => {
  it('does not resume on the first open — the session was bound on that socket', () => {
    expect(replay(['open'])).toEqual([])
  })

  it('resumes on the open that follows a drop', () => {
    expect(replay(['open', 'closed', 'reconnecting', 'open'])).toEqual(['open'])
  })

  it('resumes only once per drop, however many retries the transport made', () => {
    expect(
      replay(['open', 'closed', 'reconnecting', 'reconnecting', 'reconnecting', 'open'])
    ).toEqual(['open'])
  })

  it('resumes again after every subsequent drop', () => {
    const tracker = createReconnectResumeTracker()
    const states: ConnectionState[] = ['open', 'closed', 'open', 'closed', 'open']
    expect(states.map(state => tracker.observe(state))).toEqual([false, false, true, false, true])
  })

  it('treats a drop before any open as a drop: the first open then re-binds', () => {
    // A socket that closes during the initial handshake still leaves the session
    // unbound, so the connection that finally opens owes a resume.
    expect(replay(['closed', 'reconnecting', 'open'])).toEqual(['open'])
  })

  it('exposes the down state so the UI can be honest while it is dropped', () => {
    const tracker = createReconnectResumeTracker()
    tracker.observe('open')
    expect(tracker.dropped).toBe(false)
    tracker.observe('closed')
    expect(tracker.dropped).toBe(true)
    tracker.observe('reconnecting')
    expect(tracker.dropped).toBe(true)
    tracker.observe('open')
    expect(tracker.dropped).toBe(false)
  })
})
