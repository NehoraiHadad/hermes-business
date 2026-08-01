import { describe, expect, it } from 'vitest'
import {
  isValidationFresh,
  providerVerifiedForOnboarding,
  recordInferenceSuccess,
  recordValidation,
  VALIDATION_MAX_AGE_MS,
  type ProviderValidation
} from './provider-validation'

const now = '2026-08-01T12:00:00.000Z'
const fresh = (over: Partial<ProviderValidation> = {}): ProviderValidation => ({
  provider: 'Anthropic',
  model: 'claude-opus-4-8',
  validatedAt: now,
  ok: true,
  reachable: true,
  method: 'validate',
  ...over
})

describe('recordValidation — non-secret evidence from /api/providers/validate', () => {
  it('keeps only ok/reachable + scoping fields, never the message/secret', () => {
    const v = recordValidation({
      provider: 'OpenRouter',
      model: 'x',
      now,
      response: { ok: true, reachable: true, message: 'sk-secret-echoed-here' }
    })
    expect(v).toEqual({ provider: 'OpenRouter', model: 'x', validatedAt: now, ok: true, reachable: true, method: 'validate' })
    expect(JSON.stringify(v)).not.toContain('secret')
  })

  it('records a rejected probe as ok:false (so freshness fails closed later)', () => {
    expect(recordValidation({ provider: 'A', now, response: { ok: false, reachable: true } }).ok).toBe(false)
  })

  it('records a successful inference round-trip as live proof', () => {
    expect(recordInferenceSuccess({ provider: 'Anthropic', now }).method).toBe('inference')
  })
})

describe('isValidationFresh — recent, accepting, provider/model-scoped, fail closed', () => {
  it('accepts a recent, accepting record for the active provider+model', () => {
    expect(isValidationFresh(fresh(), { provider: 'Anthropic', model: 'claude-opus-4-8', now })).toBe(true)
  })

  it('rejects a missing or rejected (revoked) record', () => {
    expect(isValidationFresh(null, { provider: 'Anthropic', now })).toBe(false)
    expect(isValidationFresh(fresh({ ok: false }), { provider: 'Anthropic', now })).toBe(false)
  })

  it('rejects an expired record', () => {
    const old = fresh({ validatedAt: '2026-07-01T12:00:00.000Z' }) // ~31 days old
    expect(isValidationFresh(old, { provider: 'Anthropic', now })).toBe(false)
    // Boundary: exactly at max age still counts; one ms past does not.
    const atEdge = fresh({ validatedAt: new Date(Date.parse(now) - VALIDATION_MAX_AGE_MS).toISOString() })
    expect(isValidationFresh(atEdge, { provider: 'Anthropic', now })).toBe(true)
    const pastEdge = fresh({ validatedAt: new Date(Date.parse(now) - VALIDATION_MAX_AGE_MS - 1).toISOString() })
    expect(isValidationFresh(pastEdge, { provider: 'Anthropic', now })).toBe(false)
  })

  it('rejects evidence for a different provider or a different model', () => {
    expect(isValidationFresh(fresh(), { provider: 'OpenAI', now })).toBe(false)
    expect(isValidationFresh(fresh({ model: 'other-model' }), { provider: 'Anthropic', model: 'claude-opus-4-8', now })).toBe(false)
  })

  it('rejects a reachable:false record — reachable:false is NOT proof', () => {
    expect(isValidationFresh(fresh({ reachable: false }), { provider: 'Anthropic', model: 'claude-opus-4-8', now })).toBe(false)
  })

  it('rejects a model=null record when the active model is known (closes the null-model bypass)', () => {
    expect(isValidationFresh(fresh({ model: null }), { provider: 'Anthropic', model: 'claude-opus-4-8', now })).toBe(false)
  })

  it('rejects a future-dated or unparseable timestamp', () => {
    expect(isValidationFresh(fresh({ validatedAt: '2027-01-01T00:00:00.000Z' }), { provider: 'Anthropic', now })).toBe(false)
    expect(isValidationFresh(fresh({ validatedAt: 'not-a-date' }), { provider: 'Anthropic', now })).toBe(false)
  })
})

describe('providerVerifiedForOnboarding — usable AND recently validated', () => {
  it('requires both authoritative usability and a fresh validation', () => {
    const ok = providerVerifiedForOnboarding({ providerUsable: true, activeProvider: 'Anthropic', activeModel: 'claude-opus-4-8', validation: fresh(), now })
    expect(ok).toBe(true)
    expect(providerVerifiedForOnboarding({ providerUsable: false, activeProvider: 'Anthropic', validation: fresh(), now })).toBe(false)
    expect(providerVerifiedForOnboarding({ providerUsable: true, activeProvider: 'Anthropic', validation: null, now })).toBe(false)
  })
})
