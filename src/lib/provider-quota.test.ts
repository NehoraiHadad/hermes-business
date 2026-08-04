import { describe, expect, it } from 'vitest'
import { poolExhausted, resolveActiveProviderId, resolveQuotaSignal } from './provider-quota'
import type { ProviderStatus } from './provider-readiness'

const status = (sources: ProviderStatus['provider_sources'], label = 'לא מחובר') =>
  ({ provider_sources: sources, provider_label: label }) as Pick<
    ProviderStatus,
    'provider_sources' | 'provider_label'
  >

describe('resolveActiveProviderId — same proof chain as provider-readiness, never a guess', () => {
  it('oauth-positive: the logged-in catalog entry wins', () => {
    const id = resolveActiveProviderId(status({ oauth: 'positive', env: 'negative' }), [
      { id: 'nous', name: 'Nous', flow: 'device_code', status: { logged_in: false } },
      { id: 'openai-codex', name: 'Codex', flow: 'device_code', status: { logged_in: true } }
    ])
    expect(id).toBe('openai-codex')
  })

  it('env-positive: the readiness label maps back to the provider id', () => {
    expect(resolveActiveProviderId(status({ oauth: 'negative', env: 'positive' }, 'OpenRouter'), [])).toBe('openrouter')
    expect(resolveActiveProviderId(status({ oauth: 'negative', env: 'positive' }, 'Gemini'), null)).toBe('gemini')
  })

  it('no positive proof, an unknown env label, or a missing catalog entry ⇒ null (unknown, not a guess)', () => {
    expect(resolveActiveProviderId(status({ oauth: 'negative', env: 'negative' }), [])).toBeNull()
    expect(resolveActiveProviderId(status({ oauth: 'unknown', env: 'unknown' }), null)).toBeNull()
    expect(resolveActiveProviderId(status({ oauth: 'negative', env: 'positive' }, 'Mystery'), [])).toBeNull()
    expect(resolveActiveProviderId(status({ oauth: 'positive', env: 'negative' }), null)).toBeNull()
  })
})

describe('poolExhausted — Hermes\' own quota verdict, strict', () => {
  it('true only when entries exist AND every one is exhausted', () => {
    expect(poolExhausted(['exhausted'])).toBe(true)
    expect(poolExhausted(['exhausted', 'exhausted'])).toBe(true)
  })

  it('a single live credential means the provider still serves', () => {
    expect(poolExhausted(['exhausted', 'ok'])).toBe(false)
    expect(poolExhausted(['ok'])).toBe(false)
  })

  it('dead (terminal auth) is not a quota state; empty/missing pools are not exhausted', () => {
    expect(poolExhausted(['dead'])).toBe(false)
    expect(poolExhausted(['exhausted', 'dead'])).toBe(false)
    expect(poolExhausted([])).toBe(false)
    expect(poolExhausted(undefined)).toBe(false)
    expect(poolExhausted([null])).toBe(false)
  })
})

describe('resolveQuotaSignal — most-authoritative first, display-only fallbacks', () => {
  it('Hermes\' exhausted verdict outranks everything, for any provider', () => {
    expect(
      resolveQuotaSignal({
        providerId: 'openrouter',
        poolStatuses: { openrouter: ['exhausted'] },
        codexProbe: null
      })
    ).toEqual({ kind: 'exhausted' })
    // Even a healthy-looking Codex percent does not override the pool verdict.
    expect(
      resolveQuotaSignal({
        providerId: 'openai-codex',
        poolStatuses: { 'openai-codex': ['exhausted'] },
        codexProbe: { ok: true, reachable: true, usedPercent: 10 }
      })
    ).toEqual({ kind: 'exhausted' })
  })

  it('a live Codex probe yields the real percent (clamped to 100), or exhausted on its flag', () => {
    expect(
      resolveQuotaSignal({
        providerId: 'openai-codex',
        poolStatuses: { 'openai-codex': ['ok'] },
        codexProbe: { ok: true, reachable: true, usedPercent: 37.4 }
      })
    ).toEqual({ kind: 'percent', usedPercent: 37.4 })
    expect(
      resolveQuotaSignal({
        providerId: 'openai-codex',
        poolStatuses: null,
        codexProbe: { ok: false, reachable: true, quotaExhausted: true }
      })
    ).toEqual({ kind: 'exhausted' })
    expect(
      resolveQuotaSignal({
        providerId: 'openai-codex',
        poolStatuses: null,
        codexProbe: { ok: true, reachable: true, usedPercent: 250 }
      })
    ).toEqual({ kind: 'percent', usedPercent: 100 })
  })

  it('never fabricates: unknown provider, failed reads, unreachable/percent-less probes ⇒ none', () => {
    expect(resolveQuotaSignal({ providerId: null, poolStatuses: null, codexProbe: null })).toEqual({ kind: 'none' })
    expect(
      resolveQuotaSignal({ providerId: 'openrouter', poolStatuses: null, codexProbe: null })
    ).toEqual({ kind: 'none' })
    expect(
      resolveQuotaSignal({
        providerId: 'openai-codex',
        poolStatuses: { 'openai-codex': ['ok'] },
        codexProbe: { ok: false, reachable: false }
      })
    ).toEqual({ kind: 'none' })
    expect(
      resolveQuotaSignal({
        providerId: 'openai-codex',
        poolStatuses: null,
        codexProbe: { ok: true, reachable: true, usedPercent: null }
      })
    ).toEqual({ kind: 'none' })
    // A negative percent is a malformed answer, not a claim to display.
    expect(
      resolveQuotaSignal({
        providerId: 'openai-codex',
        poolStatuses: null,
        codexProbe: { ok: true, reachable: true, usedPercent: -3 }
      })
    ).toEqual({ kind: 'none' })
  })
})
