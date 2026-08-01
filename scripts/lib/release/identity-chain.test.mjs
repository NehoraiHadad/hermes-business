import { describe, expect, it } from 'vitest'
import { verifyIdentityChain } from './identity-chain.mjs'

const NONCE = 'n'.repeat(32)
const HEAD = 'a'.repeat(40)
const FP = 'f'.repeat(64)
const DIGEST = 'd'.repeat(64)

const attestation = { build_nonce: NONCE, source_head: HEAD, source_fingerprint: FP }
const manifest = { build_nonce: NONCE, commit: HEAD, attestation: { source_fingerprint: FP } }
const evidenceBinding = { build_nonce: NONCE, release_binding_digest: DIGEST }
const build = { build_nonce: NONCE, release_binding_digest: DIGEST }

describe('verifyIdentityChain — one build identity (HIGH 7)', () => {
  it('a single coherent build passes', () => {
    expect(verifyIdentityChain({ attestation, manifest, evidenceBinding, build }).ok).toBe(true)
  })
  it('ADVERSARIAL: manifest nonce from build B (nonce split) blocks', () => {
    const r = verifyIdentityChain({ attestation, manifest: { ...manifest, build_nonce: 'OTHER' }, evidenceBinding, build })
    expect(r.failures.map(f => f.code)).toContain('identity-nonce-split')
  })
  it('ADVERSARIAL: evidence captured against a different build (nonce split) blocks', () => {
    const r = verifyIdentityChain({ attestation, manifest, evidenceBinding: { ...evidenceBinding, build_nonce: 'C' }, build })
    expect(r.failures.map(f => f.code)).toContain('identity-nonce-split')
  })
  it('ADVERSARIAL: manifest commit != attestation head blocks', () => {
    const r = verifyIdentityChain({ attestation, manifest: { ...manifest, commit: 'b'.repeat(40) }, evidenceBinding, build })
    expect(r.failures.map(f => f.code)).toContain('identity-commit-split')
  })
  it('ADVERSARIAL: fingerprint split between manifest and attestation blocks', () => {
    const r = verifyIdentityChain({ attestation, manifest: { ...manifest, attestation: { source_fingerprint: 'x'.repeat(64) } }, evidenceBinding, build })
    expect(r.failures.map(f => f.code)).toContain('identity-fingerprint-split')
  })
  it('ADVERSARIAL: evidence binding digest != current build (loose A/B) blocks', () => {
    const r = verifyIdentityChain({ attestation, manifest, evidenceBinding: { ...evidenceBinding, release_binding_digest: 'e'.repeat(64) }, build })
    expect(r.failures.map(f => f.code)).toContain('identity-binding-split')
  })
  it('an attestation with no nonce cannot anchor the chain', () => {
    const r = verifyIdentityChain({ attestation: { source_head: HEAD }, manifest, evidenceBinding, build })
    expect(r.failures.map(f => f.code)).toContain('identity-no-nonce')
  })
})
