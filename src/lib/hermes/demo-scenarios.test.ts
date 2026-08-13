import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GatewayEvent } from '../../types'
import { createDemoRpc } from './demo-rpc'
import type { DemoState } from './demo'
import {
  buildApprovalFollowUpEvents,
  buildScenarioEvents,
  matchDemoScenario,
  type DemoScheduledEvent
} from './demo-scenarios'

// The three starter suggestions rendered by ChatScreen's empty state. The demo has to
// answer THESE, verbatim, because a user most often sends the chip text unchanged.
const CHIPS = {
  reply: 'נסח תשובה ללקוח',
  week: 'עזור לי לתכנן את השבוע',
  repeating: 'מצא משימה שחוזרת על עצמה'
}

const types = (events: DemoScheduledEvent[]) =>
  [...events].sort((a, b) => a.delay - b.delay).map(entry => entry.event.type)

const textOf = (events: DemoScheduledEvent[]) =>
  events.map(entry => String(entry.event.payload?.text || '')).join('')

describe('matchDemoScenario — starter chips', () => {
  it('maps each starter chip to its own scenario', () => {
    expect(matchDemoScenario(CHIPS.reply).id).toBe('client-reply')
    expect(matchDemoScenario(CHIPS.week).id).toBe('week-plan')
    expect(matchDemoScenario(CHIPS.repeating).id).toBe('repeating-task')
  })

  it('still matches after the user edits the chip text in the composer', () => {
    expect(matchDemoScenario(`${CHIPS.repeating} דחוף`).id).toBe('repeating-task')
    expect(matchDemoScenario('עזור לי לתכנן את השבוע, בבקשה!').id).toBe('week-plan')
    expect(matchDemoScenario('תוכל לנסח לי תשובה ללקוח החדש?').id).toBe('client-reply')
    expect(matchDemoScenario('  מה יש לי ביומן השבוע  ').id).toBe('week-plan')
  })

  it('resolves overlapping prompts by the most specific signal first', () => {
    // Recurrence beats planning: a task that repeats every week is an automation ask.
    expect(matchDemoScenario('תכנן לי משימה שחוזרת כל שבוע').id).toBe('repeating-task')
    // Recurrence also beats the client thread.
    expect(matchDemoScenario('מצא משימה שחוזרת מול לקוחות').id).toBe('repeating-task')
    // Answering a client beats the weekly plan it happens to mention.
    expect(matchDemoScenario('נסח תשובה ללקוח לפני הפגישה השבוע').id).toBe('client-reply')
  })

  it('falls back honestly on unrelated free text', () => {
    expect(matchDemoScenario('מה מזג האוויר מחר בבוקר').id).toBe('fallback')
    expect(matchDemoScenario('').id).toBe('fallback')
    expect(matchDemoScenario('?!').id).toBe('fallback')
  })
})

describe('buildScenarioEvents — event sequence', () => {
  it('keeps the real transport order: start, tool, deltas, approval, complete', () => {
    const events = buildScenarioEvents(matchDemoScenario(CHIPS.reply), 's1')
    expect(types(events)).toEqual([
      'message.start',
      'tool.start',
      'tool.complete',
      'message.delta',
      'message.delta',
      'message.delta',
      'message.delta',
      'approval.request',
      'message.complete'
    ])
    const complete = events.find(entry => entry.event.type === 'message.complete')
    expect(complete?.event.payload?.text).toBe(textOf(events.filter(e => e.event.type === 'message.delta')))
    expect(events.every(entry => entry.event.session_id === 's1')).toBe(true)
  })

  it('raises an approval only in the client-reply scenario', () => {
    const week = buildScenarioEvents(matchDemoScenario(CHIPS.week), 's1')
    const repeating = buildScenarioEvents(matchDemoScenario(CHIPS.repeating), 's1')
    expect(types(week)).not.toContain('approval.request')
    expect(types(repeating)).not.toContain('approval.request')
    expect(types(week)).toContain('tool.start')
    expect(textOf(week)).toContain('יומן')
    expect(textOf(repeating)).toContain('משימה קבועה')
  })

  it('never claims work in the fallback — no tool activity, no approval', () => {
    const events = buildScenarioEvents(matchDemoScenario('שאלה כללית לגמרי'), 's1')
    expect(types(events)).toEqual(['message.start', 'message.delta', 'message.delta', 'message.delta', 'message.complete'])
    expect(textOf(events)).toContain('הדגמה')
    expect(textOf(events)).toContain(CHIPS.week)
  })

  it('streams with staggered delays so the pacing stays believable', () => {
    const events = buildScenarioEvents(matchDemoScenario(CHIPS.week), 's1')
    const delays = [...events].sort((a, b) => a.delay - b.delay).map(entry => entry.delay)
    expect(delays[0]).toBeGreaterThan(0)
    expect(new Set(delays).size).toBe(delays.length)
  })
})

describe('buildApprovalFollowUpEvents', () => {
  const scenario = matchDemoScenario(CHIPS.reply)

  it('streams a sent-confirmation when the user approves', () => {
    const events = buildApprovalFollowUpEvents(scenario, 'once', 's1')
    expect(types(events)).toEqual(['message.start', 'message.delta', 'message.delta', 'message.delta', 'message.complete'])
    expect(textOf(events.filter(e => e.event.type === 'message.delta'))).toContain('שלחתי את המייל לדני')
  })

  it('treats a session-wide approval as an approval too', () => {
    expect(textOf(buildApprovalFollowUpEvents(scenario, 'session', 's1'))).toContain('שלחתי')
  })

  it('confirms nothing was sent when the user denies', () => {
    const events = buildApprovalFollowUpEvents(scenario, 'deny', 's1')
    expect(types(events)).not.toContain('approval.request')
    expect(textOf(events)).toContain('לא שלחתי כלום')
  })

  it('has nothing to follow up on for a scenario that never asked for approval', () => {
    expect(buildApprovalFollowUpEvents(matchDemoScenario(CHIPS.week), 'once', 's1')).toEqual([])
  })
})

describe('demo rpc approval state machine', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const drive = () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', globalThis)
    const state: DemoState = { activeSession: 'weekly-leads', pendingApproval: null }
    const emitted: GatewayEvent[] = []
    const emit = (event: GatewayEvent) => emitted.push(event)
    return { state, emitted, emit, rpc: createDemoRpc(state) }
  }

  it('remembers the pending scenario while an approval is open, then answers it', async () => {
    const { state, emitted, emit, rpc } = drive()
    await rpc('prompt.submit', { session_id: 's1', text: CHIPS.reply }, emit)
    vi.advanceTimersByTime(5_000)
    expect(state.pendingApproval).toBe('client-reply')
    expect(emitted.map(event => event.type)).toContain('approval.request')

    emitted.length = 0
    await rpc('approval.respond', { session_id: 's1', choice: 'once' }, emit)
    vi.advanceTimersByTime(5_000)
    expect(state.pendingApproval).toBeNull()
    expect(emitted.map(event => event.type)).toEqual([
      'message.start',
      'message.delta',
      'message.delta',
      'message.delta',
      'message.complete'
    ])
    expect(emitted.every(event => event.session_id === 's1')).toBe(true)
  })

  it('answers a denial without sending anything, and only once', async () => {
    const { state, emitted, emit, rpc } = drive()
    await rpc('prompt.submit', { session_id: 's1', text: CHIPS.reply }, emit)
    vi.advanceTimersByTime(5_000)
    emitted.length = 0

    await rpc('approval.respond', { session_id: 's1', choice: 'deny' }, emit)
    vi.advanceTimersByTime(5_000)
    expect(emitted.map(event => String(event.payload?.text || '')).join('')).toContain('לא שלחתי כלום')

    // A second answer has no pending scenario left and must stay silent.
    emitted.length = 0
    await expect(rpc('approval.respond', { session_id: 's1', choice: 'once' }, emit)).resolves.toEqual({ ok: true })
    vi.advanceTimersByTime(5_000)
    expect(emitted).toEqual([])
    expect(state.pendingApproval).toBeNull()
  })

  it('clears a stale pending approval when the next prompt raises none', async () => {
    const { state, emitted, emit, rpc } = drive()
    await rpc('prompt.submit', { session_id: 's1', text: CHIPS.reply }, emit)
    vi.advanceTimersByTime(5_000)
    await rpc('prompt.submit', { session_id: 's1', text: CHIPS.week }, emit)
    vi.advanceTimersByTime(5_000)
    expect(state.pendingApproval).toBeNull()

    emitted.length = 0
    await expect(rpc('approval.respond', { session_id: 's1', choice: 'once' }, emit)).resolves.toEqual({ ok: true })
    vi.advanceTimersByTime(5_000)
    expect(emitted.filter(event => event.type === 'message.start')).toEqual([])
  })
})
