import { describe, expect, it } from 'vitest'
import { verifyLockAttestation, LOCK_ATTEST_SCHEME } from './lock-attest.mjs'

const LOCK = 'l'.repeat(64)
const good = { scheme: LOCK_ATTEST_SCHEME, package_lock_sha256: LOCK, node_version: 'v22.10.0', npm_version: '10.9.0', ci_clean: true }

describe('verifyLockAttestation (HIGH 5)', () => {
  it('a matching, clean, provenance-bearing attestation verifies', () => {
    const r = verifyLockAttestation({ attestation: good, currentLockSha256: LOCK, channel: 'public' })
    expect(r.ok).toBe(true)
    expect(r.provenance).toMatchObject({ node: 'v22.10.0', npm: '10.9.0' })
  })
  it('ADVERSARIAL: a self-asserted { verified:true } with no fields fails public', () => {
    const r = verifyLockAttestation({ attestation: { verified: true }, currentLockSha256: LOCK, channel: 'public' })
    expect(r.ok).toBe(false)
    expect(r.failures.map(f => f.code)).toEqual(expect.arrayContaining(['lock-attest-no-hash', 'lock-attest-no-provenance', 'lock-attest-not-clean']))
  })
  it('ADVERSARIAL: lockfile edited after the clean install → hash mismatch blocks', () => {
    const r = verifyLockAttestation({ attestation: good, currentLockSha256: 'z'.repeat(64), channel: 'public' })
    expect(r.failures.map(f => f.code)).toContain('lock-attest-mismatch')
  })
  it('a non-clean install (npm install, not ci) blocks', () => {
    const r = verifyLockAttestation({ attestation: { ...good, ci_clean: false }, currentLockSha256: LOCK, channel: 'public' })
    expect(r.failures.map(f => f.code)).toContain('lock-attest-not-clean')
  })
  it('missing provenance (no node/npm) blocks', () => {
    const r = verifyLockAttestation({ attestation: { ...good, node_version: undefined }, currentLockSha256: LOCK, channel: 'public' })
    expect(r.failures.map(f => f.code)).toContain('lock-attest-no-provenance')
  })
  it('absent attestation is tolerated by qa, fails closed for public', () => {
    expect(verifyLockAttestation({ attestation: null, currentLockSha256: LOCK, channel: 'qa' }).ok).toBe(true)
    expect(verifyLockAttestation({ attestation: null, currentLockSha256: LOCK, channel: 'public' }).ok).toBe(false)
  })
  it('pilot is full-rigor: absent attestation fails closed exactly like public', () => {
    const r = verifyLockAttestation({ attestation: null, currentLockSha256: LOCK, channel: 'pilot' })
    expect(r.ok).toBe(false)
    expect(r.failures.map(f => f.code)).toContain('lock-integrity-unattested')
  })
  it('pilot accepts a matching, clean attestation exactly like public', () => {
    const r = verifyLockAttestation({ attestation: good, currentLockSha256: LOCK, channel: 'pilot' })
    expect(r.ok).toBe(true)
  })
})
