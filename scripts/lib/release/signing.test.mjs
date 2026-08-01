import { describe, expect, it } from 'vitest'
import { classifySignature, evaluateSigning, signerApproved } from './signing.mjs'

const APPROVED = { subjects: ['Contoso, Inc.'], thumbprints: ['AABBCCDDEEFF00112233445566778899AABBCCDD'] }
const goodSig = { verified: true, publisher: 'Contoso, Inc.', thumbprint: 'AA BB CC DD EE FF 00 11 22 33 44 55 66 77 88 99 AA BB CC DD', rfc3161: true }

describe('classifySignature', () => {
  it('signtool-verified + rfc3161 → valid, trusted, publisher+thumbprint captured', () => {
    const s = classifySignature(goodSig)
    expect(s).toMatchObject({ valid: true, trustedTimestamp: true, publisher: 'Contoso, Inc.' })
    expect(s.thumbprint).toBe('AABBCCDDEEFF00112233445566778899AABBCCDD')
  })
  it('undetectable (no signtool / off-Windows) → unsigned', () => {
    expect(classifySignature({ detectable: false })).toMatchObject({ valid: false, status: 'undetectable' })
  })
})

describe('signerApproved — allowlist (finding 8)', () => {
  it('empty allowlist approves nobody (no cert assumed)', () => {
    expect(signerApproved(classifySignature(goodSig), {})).toBe(false)
  })
  it('matches by subject OR normalized thumbprint', () => {
    expect(signerApproved(classifySignature(goodSig), APPROVED)).toBe(true)
    expect(signerApproved(classifySignature({ ...goodSig, publisher: 'Evil Corp' }), APPROVED)).toBe(true) // thumbprint
    expect(signerApproved(classifySignature({ ...goodSig, thumbprint: 'DEAD' }), { subjects: ['Contoso, Inc.'] })).toBe(true)
  })
})

describe('evaluateSigning — public gate (finding 8)', () => {
  const sig = classifySignature(goodSig)
  it('public + approved signer + timestamp → distributable', () => {
    const v = evaluateSigning({ channel: 'public', installer: sig, app: sig, allowlist: APPROVED })
    expect(v.failures).toEqual([])
    expect(v.distributable).toBe(true)
  })
  it('WRONG signer (not on allowlist) blocks public (adversarial)', () => {
    const wrong = classifySignature({ ...goodSig, publisher: 'Evil Corp', thumbprint: 'DEAD' })
    const v = evaluateSigning({ channel: 'public', installer: wrong, app: wrong, allowlist: APPROVED })
    expect(v.distributable).toBe(false)
    expect(v.failures.map(f => f.code)).toContain('publisher-not-approved')
  })
  it('valid signer but NO trusted timestamp is flagged', () => {
    const noTs = classifySignature({ ...goodSig, rfc3161: false })
    const v = evaluateSigning({ channel: 'public', installer: noTs, app: noTs, allowlist: APPROVED })
    expect(v.failures.map(f => f.code)).toContain('untrusted-timestamp-public')
  })
  it('unsigned public → unsigned-public, non-distributable', () => {
    const v = evaluateSigning({ channel: 'public', installer: null, app: null, allowlist: APPROVED })
    expect(v.distributable).toBe(false)
    expect(v.failures.map(f => f.code)).toContain('unsigned-public')
  })
  it('QA unsigned → allowed but labeled NON-DISTRIBUTABLE', () => {
    const v = evaluateSigning({ channel: 'qa', installer: null, app: null })
    expect(v.failures).toEqual([])
    expect(v.distributable).toBe(false)
    expect(v.label).toMatch(/NON-DISTRIBUTABLE/)
  })
  it('unknown channel fails closed', () => {
    const v = evaluateSigning({ channel: 'nightly', installer: null, app: null })
    expect(v.failures.map(f => f.code)).toContain('unknown-channel')
  })
})
