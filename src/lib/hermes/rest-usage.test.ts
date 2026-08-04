import { describe, expect, it, vi } from 'vitest'
import { createUsageApi } from './rest-usage'
import type { ApiFn } from './core'

const fakeApi = (respond: (endpoint: string) => unknown) => {
  const calls: string[] = []
  const api = vi.fn(async (endpoint: string) => {
    calls.push(endpoint)
    return respond(endpoint)
  }) as unknown as ApiFn
  return { api, calls }
}

describe('createUsageApi — the single cross-provider local usage read', () => {
  it('reads the 30-day and today windows from the one aggregation door and returns both', async () => {
    const { api, calls } = fakeApi(endpoint =>
      endpoint.includes('days=1&') || endpoint.endsWith('days=1')
        ? { totals: { total_api_calls: 4, total_sessions: 2 } }
        : { totals: { total_api_calls: 87, total_sessions: 23 } }
    )
    const summary = await createUsageApi(api).getUsageSummary()
    expect(summary).toEqual({ todayApiCalls: 4, periodApiCalls: 87, periodSessions: 23, periodDays: 30 })
    expect(calls).toEqual([
      '/api/analytics/usage?days=30&profile=default',
      '/api/analytics/usage?days=1&profile=default'
    ])
  })

  it('treats SQLite null sums as a REAL zero (the read succeeded and found nothing)', async () => {
    const { api } = fakeApi(() => ({ totals: { total_api_calls: null, total_sessions: 0 } }))
    const summary = await createUsageApi(api).getUsageSummary()
    expect(summary).toEqual({ todayApiCalls: 0, periodApiCalls: 0, periodSessions: 0, periodDays: 30 })
  })

  it('REFUSES a response without totals — an unexpected endpoint shape must never read as zero usage', async () => {
    const { api } = fakeApi(() => ({ ok: true }))
    await expect(createUsageApi(api).getUsageSummary()).rejects.toThrow(/totals/)
  })

  it('propagates a failed read instead of fabricating data', async () => {
    const { api } = fakeApi(() => {
      throw new Error('gateway unreachable')
    })
    await expect(createUsageApi(api).getUsageSummary()).rejects.toThrow('gateway unreachable')
  })
})

describe('createUsageApi — credential-pool status read (Hermes\' quota verdict)', () => {
  it('maps the pool to provider → last_status list, tolerating partial entries', async () => {
    const { api, calls } = fakeApi(() => ({
      providers: [
        { provider: 'openai-codex', entries: [{ last_status: 'ok' }, { last_status: 'exhausted' }] },
        { provider: 'openrouter', entries: [{}] },
        { provider: '', entries: [{ last_status: 'ok' }] },
        { notAProvider: true }
      ]
    }))
    await expect(createUsageApi(api).getCredentialPoolStatuses()).resolves.toEqual({
      'openai-codex': ['ok', 'exhausted'],
      openrouter: [null]
    })
    expect(calls).toEqual(['/api/credentials/pool'])
  })

  it('REFUSES a response without a providers list — never an empty-and-healthy pool', async () => {
    const { api } = fakeApi(() => ({ ok: true }))
    await expect(createUsageApi(api).getCredentialPoolStatuses()).rejects.toThrow(/providers/)
  })
})
