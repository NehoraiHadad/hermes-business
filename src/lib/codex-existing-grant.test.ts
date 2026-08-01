import { describe, expect, it } from 'vitest'
import { gateExistingCodexGrant } from './codex-existing-grant'
import { providerVerifiedForOnboarding, recordValidation, type ProviderValidation } from './provider-validation'

// End-to-end guarantee: a revoked / expired / unreachable EXISTING Codex grant can never
// mint fresh 24h evidence, so onboarding stays incomplete. `gateExistingCodexGrant` is the
// only door to recording evidence in the useExisting flow; when it denies, NO evidence is
// written and the onboarding gate keeps failing on whatever (stale/absent) record existed.
const NOW = '2026-08-01T12:00:00.000Z'

// Model the useExisting flow: probe → gate → record ONLY when allowed. Returns the evidence
// that would be persisted (null when the gate denies), mirroring CodexOAuth.useExisting.
function runUseExisting(probe: { ok: boolean; reachable: boolean; message?: string } | null): ProviderValidation | null {
  const gate = gateExistingCodexGrant(probe)
  if (!gate.allow) return null
  return recordValidation({
    provider: 'openai-codex',
    model: 'openai/gpt-5-codex',
    now: NOW,
    response: { ok: true, reachable: true },
    method: 'validate'
  })
}

function verified(evidence: ProviderValidation | null) {
  return providerVerifiedForOnboarding({
    providerUsable: true,
    activeProvider: 'openai-codex',
    activeModel: 'openai/gpt-5-codex',
    validation: evidence,
    now: NOW
  })
}

describe('gateExistingCodexGrant — a stored grant must prove liveness before minting evidence', () => {
  it('allows ONLY an accepting + reachable probe', () => {
    expect(gateExistingCodexGrant({ ok: true, reachable: true })).toEqual({ allow: true })
  })

  it('denies a revoked/expired grant (ok:false, reachable:true) with the probe message', () => {
    const gate = gateExistingCodexGrant({ ok: false, reachable: true, message: 'grant revoked' })
    expect(gate).toEqual({ allow: false, error: 'grant revoked' })
  })

  it('denies an unreachable/un-probed grant (reachable:false) — reachable:false is NOT proof', () => {
    expect(gateExistingCodexGrant({ ok: false, reachable: false }).allow).toBe(false)
  })

  it('fails closed when the probe capability is unavailable (null probe)', () => {
    const gate = gateExistingCodexGrant(null)
    expect(gate.allow).toBe(false)
  })
})

describe('a denied grant never completes onboarding', () => {
  it.each([
    { label: 'revoked/expired', probe: { ok: false, reachable: true, message: 'x' } },
    { label: 'unreachable', probe: { ok: false, reachable: false } },
    { label: 'probe unavailable', probe: null }
  ])('records NO evidence and stays incomplete: $label', ({ probe }) => {
    const evidence = runUseExisting(probe)
    expect(evidence).toBeNull()
    // With no fresh accepting record, the onboarding provider gate stays false.
    expect(verified(evidence)).toBe(false)
  })

  it('a LIVE grant records fresh evidence and completes the provider gate', () => {
    const evidence = runUseExisting({ ok: true, reachable: true })
    expect(evidence).toMatchObject({ provider: 'openai-codex', ok: true, reachable: true, method: 'validate' })
    expect(verified(evidence)).toBe(true)
  })
})
