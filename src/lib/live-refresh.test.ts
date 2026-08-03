import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHANGE_EVENT_SLICES, readChangeEventsCapability, routeChangeEvent } from './live-refresh'
import type { GatewayEvent } from '../types'

describe('routeChangeEvent', () => {
  it('routes every known Hermes 0.19.1 change event to the documented slices (§5.1)', () => {
    expect(routeChangeEvent({ type: 'sessions.changed' })).toEqual(['sessions'])
    expect(routeChangeEvent({ type: 'cron.changed' })).toEqual(['schedule', 'partner'])
    expect(routeChangeEvent({ type: 'platforms.changed' })).toEqual(['connections'])
  })

  it('routes the documented-but-unconsumed events to no slice, deliberately', () => {
    expect(routeChangeEvent({ type: 'pairing.changed' })).toEqual([])
    expect(routeChangeEvent({ type: 'pet.changed' })).toEqual([])
    expect(routeChangeEvent({ type: 'skin.changed' })).toEqual([])
  })

  it('routes gateway.ready to no slice (it only seeds the change_events gate)', () => {
    expect(routeChangeEvent({ type: 'gateway.ready', payload: { change_events: true } })).toEqual([])
  })

  it('is pure and total: an unknown event routes to [] and never throws', () => {
    expect(() => routeChangeEvent({ type: 'some.future.event' })).not.toThrow()
    expect(routeChangeEvent({ type: 'some.future.event' })).toEqual([])
    expect(routeChangeEvent({ type: '' })).toEqual([])
  })

  it('never returns a shared mutable reference callers could corrupt the routing table with', () => {
    const a = routeChangeEvent({ type: 'sessions.changed' })
    a.push('health')
    expect(routeChangeEvent({ type: 'sessions.changed' })).toEqual(['sessions'])
  })
})

describe('readChangeEventsCapability', () => {
  it('extracts payload.change_events from a gateway.ready event', () => {
    expect(readChangeEventsCapability({ type: 'gateway.ready', payload: { change_events: true } })).toBe(true)
    expect(readChangeEventsCapability({ type: 'gateway.ready', payload: { change_events: false } })).toBe(false)
  })

  it('is fail-closed: a missing or non-boolean flag reads as false, never true', () => {
    expect(readChangeEventsCapability({ type: 'gateway.ready', payload: {} })).toBe(false)
    expect(readChangeEventsCapability({ type: 'gateway.ready' })).toBe(false)
    expect(readChangeEventsCapability({ type: 'gateway.ready', payload: { change_events: 'yes' } })).toBe(false)
    expect(readChangeEventsCapability({ type: 'gateway.ready', payload: { change_events: null } })).toBe(false)
  })

  it('returns null for every event that is not gateway.ready — including the change events themselves', () => {
    expect(readChangeEventsCapability({ type: 'sessions.changed', payload: { change_events: true } })).toBeNull()
    expect(readChangeEventsCapability({ type: 'cron.changed' })).toBeNull()
    expect(readChangeEventsCapability({ type: 'message.start' })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Lockstep test (docs/specs/live-refresh.md §8 point 4), modeled on
// electron/constants-lockstep.test.ts: extract the chat-event vocabulary
// straight out of chat-events.ts's source text (so this test keeps tracking
// reality if that file's event list changes — no hand-maintained copy to
// drift), and assert:
//   (a) it never overlaps with the change-event vocabulary this module routes
//       (a chat event must never be treated as a change event, and vice versa)
//   (b) every event this module DOES route belongs to the documented,
//       closed Hermes 0.19.1 broadcast vocabulary from §3.3 plus gateway.ready
// ---------------------------------------------------------------------------
const repoRoot = path.resolve(__dirname, '../..')
const chatEventsSource = fs.readFileSync(path.join(repoRoot, 'src/lib/hermes/chat-events.ts'), 'utf8')

function extractChatEventVocabulary(source: string): string[] {
  const matches = [...source.matchAll(/event\.type === '([a-z][a-z.]*)'/g)]
  return matches.map(match => match[1])
}

const DOCUMENTED_CHANGE_VOCABULARY = new Set([
  'cron.changed',
  'sessions.changed',
  'platforms.changed',
  'pairing.changed',
  'pet.changed',
  'skin.changed',
  'gateway.ready'
])

describe('chat-event vocabulary stays disjoint from the change-event vocabulary', () => {
  const chatVocabulary = extractChatEventVocabulary(chatEventsSource)

  it('chat-events.ts actually has a vocabulary to compare against (sanity check on the extraction itself)', () => {
    expect(chatVocabulary.length).toBeGreaterThan(0)
    expect(chatVocabulary).toContain('message.delta')
  })

  it('no event type routed by live-refresh.ts is also handled by chat-events.ts, and vice versa', () => {
    const changeVocabulary = new Set([...Object.keys(CHANGE_EVENT_SLICES), 'gateway.ready'])
    for (const chatEvent of chatVocabulary) {
      expect(changeVocabulary.has(chatEvent)).toBe(false)
    }
    for (const changeEvent of changeVocabulary) {
      expect(chatVocabulary.includes(changeEvent)).toBe(false)
    }
  })

  it('every event key in CHANGE_EVENT_SLICES belongs to the documented Hermes 0.19.1 vocabulary (§3.3) ∪ gateway.ready', () => {
    for (const eventType of Object.keys(CHANGE_EVENT_SLICES)) {
      expect(DOCUMENTED_CHANGE_VOCABULARY.has(eventType)).toBe(true)
    }
  })

  it('routeChangeEvent never routes a chat event to a slice', () => {
    for (const chatEvent of chatVocabulary) {
      const event: GatewayEvent = { type: chatEvent }
      expect(routeChangeEvent(event)).toEqual([])
    }
  })
})
