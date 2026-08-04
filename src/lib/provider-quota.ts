import type { OAuthProvider } from './hermes/providers'
import type { ProviderStatus } from './provider-readiness'

// The quota tier of the support panel's usage row: "what's LEFT", layered above
// the local "what I used" accounting, from the two real doors Hermes has:
//
//   1. Hermes' own credential pool (`GET /api/credentials/pool`): on a provider
//      429 Hermes marks the credential `exhausted` and freezes it until its
//      reset time — the authoritative, cross-provider "the quota ran out NOW"
//      verdict (reactive: it knows after the provider said so).
//   2. Codex's live `/usage` probe (main process): the one provider-side
//      "% of quota used" number that exists — proactive, Codex only.
//
// Like everything on this row, the signal is DISPLAY-ONLY: every unknown,
// failure, or ambiguity resolves to { kind: 'none' } (the row falls back to the
// local usage counts), never to a claim we cannot back and never to a gate.

export type QuotaSignal =
  | { kind: 'exhausted' }
  | { kind: 'percent'; usedPercent: number }
  | { kind: 'none' }

export type CodexQuotaProbe = {
  ok: boolean
  reachable: boolean
  usedPercent?: number | null
  quotaExhausted?: boolean
}

// The env-key labels provider-readiness reports (shared/provider-readiness.js
// API_KEY_PROVIDERS) mapped back to provider ids — our own stable contract.
const ENV_LABEL_TO_ID: Record<string, string> = {
  OpenRouter: 'openrouter',
  Anthropic: 'anthropic',
  Gemini: 'gemini',
  OpenAI: 'openai'
}

/**
 * Which provider id is the ACTIVE one, per the same proof provider-readiness
 * used: the logged-in OAuth catalog entry when the oauth source was positive,
 * else the env-key label mapping. Null when we cannot tell — never a guess.
 */
export function resolveActiveProviderId(
  provider: Pick<ProviderStatus, 'provider_sources' | 'provider_label'>,
  catalog: OAuthProvider[] | null | undefined
): string | null {
  if (provider.provider_sources?.oauth === 'positive') {
    const active = (catalog || []).find(entry => entry?.status?.logged_in)
    return active?.id || null
  }
  if (provider.provider_sources?.env === 'positive') {
    return ENV_LABEL_TO_ID[provider.provider_label] || null
  }
  return null
}

// Hermes' pool verdict for one provider: exhausted only when entries exist AND
// every one of them is `exhausted` — a single live credential means the provider
// still serves. `dead` (terminal auth failure) is not a quota state.
export function poolExhausted(statuses: Array<string | null> | undefined): boolean {
  return Array.isArray(statuses) && statuses.length > 0 && statuses.every(status => status === 'exhausted')
}

/**
 * Combine the doors into the row's quota signal, most-authoritative first:
 * Hermes' exhausted verdict, then the Codex live percent, else none.
 */
export function resolveQuotaSignal(input: {
  providerId: string | null
  poolStatuses: Record<string, Array<string | null>> | null
  codexProbe: CodexQuotaProbe | null
}): QuotaSignal {
  const { providerId, poolStatuses, codexProbe } = input
  if (!providerId) return { kind: 'none' }
  if (poolStatuses && poolExhausted(poolStatuses[providerId])) return { kind: 'exhausted' }
  if (providerId === 'openai-codex' && codexProbe && codexProbe.reachable) {
    if (codexProbe.quotaExhausted) return { kind: 'exhausted' }
    const used = codexProbe.usedPercent
    if (codexProbe.ok && typeof used === 'number' && Number.isFinite(used) && used >= 0) {
      return { kind: 'percent', usedPercent: Math.min(100, used) }
    }
  }
  return { kind: 'none' }
}
