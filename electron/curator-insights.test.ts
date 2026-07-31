import { describe, expect, it } from 'vitest'
import { getCuratorInsights } from './curator-insights.cjs'

function recorder(map: Record<string, unknown | (() => never)>) {
  const calls: string[] = []
  const api = async (endpoint: string) => {
    calls.push(endpoint)
    const value = map[endpoint]
    if (typeof value === 'function') return (value as () => never)()
    return value
  }
  return { api, calls }
}

describe('getCuratorInsights', () => {
  it('queries the two official endpoints (profile-scoped learning graph)', async () => {
    const { api, calls } = recorder({ '/api/curator': {}, '/api/learning/graph?profile=default': {} })
    await getCuratorInsights(api)
    expect(calls).toEqual(['/api/curator', '/api/learning/graph?profile=default'])
  })

  it('passes raw payloads through unchanged and marks available', async () => {
    const curator = { paused: false, last_run_at: '2026-07-31T09:00:00Z' }
    const learning = { stats: { learned_skills: 2 } }
    const { api } = recorder({ '/api/curator': curator, '/api/learning/graph?profile=default': learning })
    expect(await getCuratorInsights(api)).toEqual({ available: true, curator, learning })
  })

  it('is unavailable (never fabricates) when both endpoints fail', async () => {
    const boom = () => {
      throw new Error('gateway down')
    }
    const { api } = recorder({ '/api/curator': boom, '/api/learning/graph?profile=default': boom })
    expect(await getCuratorInsights(api)).toEqual({ available: false, curator: null, learning: null })
  })

  it('stays available on a partial failure of one endpoint', async () => {
    const boom = () => {
      throw new Error('down')
    }
    const learning = { stats: { learned_skills: 1 } }
    const { api } = recorder({ '/api/curator': boom, '/api/learning/graph?profile=default': learning })
    expect(await getCuratorInsights(api)).toEqual({ available: true, curator: null, learning })
  })
})
