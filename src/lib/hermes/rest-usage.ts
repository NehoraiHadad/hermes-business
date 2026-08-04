import { withProfile, type ApiFn } from './core'

// Local usage accounting for the support panel's usage row, read from Hermes'
// single cross-provider aggregation door (`GET /api/analytics/usage`). This is
// "what I used" (local session accounting), NEVER "what's left at the provider"
// — no quota claim is ever derived from it. The row it feeds is display-only:
// a failed or malformed read throws here and the caller renders an honest
// "no data" state; nothing in the product gates on this value.

export type UsageSummary = {
  todayApiCalls: number
  periodApiCalls: number
  periodSessions: number
  periodDays: number
}

export interface HermesUsageApi {
  getUsageSummary(): Promise<UsageSummary>
  // Per-provider credential statuses from Hermes' own pool (`ok` / `exhausted` /
  // `dead` / null) — Hermes' authoritative quota verdict: it freezes a credential
  // on a provider 429 until its reset time. Read-only, secrets redacted server-side.
  getCredentialPoolStatuses(): Promise<Record<string, Array<string | null>>>
}

type UsageTotals = {
  total_api_calls?: number | null
  total_sessions?: number | null
}

// SQLite SUM over an empty set is null — that IS a real zero (the read
// succeeded and found nothing). A missing `totals` object, by contrast, means
// we did not get the endpoint we expected (older Hermes, error body) and must
// NOT be presented as zero usage.
const count = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0

export function createUsageApi(api: ApiFn): HermesUsageApi {
  const readTotals = async (days: number): Promise<UsageTotals> => {
    const result = await api<{ totals?: UsageTotals }>(withProfile(`/api/analytics/usage?days=${days}`))
    if (!result || typeof result !== 'object' || !result.totals || typeof result.totals !== 'object') {
      throw new Error('Hermes usage analytics response is missing totals')
    }
    return result.totals
  }

  return {
    async getUsageSummary() {
      const [period, today] = await Promise.all([readTotals(30), readTotals(1)])
      return {
        todayApiCalls: count(today.total_api_calls),
        periodApiCalls: count(period.total_api_calls),
        periodSessions: count(period.total_sessions),
        periodDays: 30
      }
    },

    async getCredentialPoolStatuses() {
      const result = await api<{
        providers?: Array<{ provider?: string; entries?: Array<{ last_status?: string | null }> }>
      }>('/api/credentials/pool')
      if (!result || typeof result !== 'object' || !Array.isArray(result.providers)) {
        throw new Error('Hermes credential-pool response is missing providers')
      }
      const statuses: Record<string, Array<string | null>> = {}
      for (const entry of result.providers) {
        if (!entry || typeof entry.provider !== 'string' || !entry.provider) continue
        statuses[entry.provider] = (Array.isArray(entry.entries) ? entry.entries : []).map(item =>
          item && typeof item.last_status === 'string' ? item.last_status : null
        )
      }
      return statuses
    }
  }
}
