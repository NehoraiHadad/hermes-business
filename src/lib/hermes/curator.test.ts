import { describe, expect, it, vi, afterEach } from 'vitest'
import { deriveCuratorNotifications, type CuratorInsights } from './curator'

afterEach(() => vi.useRealTimers())

describe('deriveCuratorNotifications', () => {
  it('returns nothing when insights are unavailable — never fabricates', () => {
    expect(deriveCuratorNotifications(null)).toEqual([])
    expect(deriveCuratorNotifications({ available: false, curator: null, learning: null })).toEqual([])
  })

  it('reports learned skills only from the official learning stats', () => {
    const insights: CuratorInsights = {
      available: true,
      curator: null,
      learning: { stats: { learned_skills: 3 } }
    }
    const notes = deriveCuratorNotifications(insights)
    expect(notes.map(n => n.id)).toContain('learning-skills')
    expect(notes.find(n => n.id === 'learning-skills')?.title).toContain('3')
  })

  it('does not emit a learned-skills note when the count is zero or missing', () => {
    expect(
      deriveCuratorNotifications({ available: true, curator: null, learning: { stats: { learned_skills: 0 } } })
    ).toEqual([])
    expect(
      deriveCuratorNotifications({ available: true, curator: null, learning: { stats: {} } })
    ).toEqual([])
  })

  it('surfaces the last curator review time from last_run_at', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-31T12:00:00Z'))
    const notes = deriveCuratorNotifications({
      available: true,
      curator: { last_run_at: '2026-07-31T09:00:00Z', paused: false },
      learning: null
    })
    const note = notes.find(n => n.id === 'curator-last-run')
    expect(note).toBeTruthy()
    expect(note?.detail).toContain('לפני 3 שעות')
  })

  it('shows a paused note instead of a last-run note when paused', () => {
    const notes = deriveCuratorNotifications({
      available: true,
      curator: { paused: true, last_run_at: '2026-07-31T09:00:00Z' },
      learning: null
    })
    expect(notes.map(n => n.id)).toContain('curator-paused')
    expect(notes.map(n => n.id)).not.toContain('curator-last-run')
  })
})
