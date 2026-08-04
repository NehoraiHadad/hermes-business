import { describe, expect, it } from 'vitest'
import { decidePayloadPeCoverage, extractAndVerifyPayloadPes, coverageDigest } from './pe-containment.mjs'
import { isSigningTolerant } from './channel-policy.mjs'

const approved = () => true
const valid = { valid: true, trustedTimestamp: true, publisher: 'Contoso, Inc.', thumbprint: 'AA', status: 'Valid' }

describe('decidePayloadPeCoverage (CRITICAL 2 final verifier)', () => {
  const mustSign = ['app.exe', 'resources/elevate.exe', 'ffmpeg.dll']

  // Channel parity contract: the gate's inline `channel !== 'public'` must keep
  // agreeing with channel-policy's isSigningTolerant grouping — qa and pilot are
  // lenient (never a blocker, never "proven"), public runs the full gate. Guards
  // the planned refactor of the inline check onto isSigningTolerant.
  it('qa and pilot verdicts match isSigningTolerant leniency; public stays strict', () => {
    const extracted = [{ path: 'app.exe', extracted: false, signature: null }]
    for (const channel of ['qa', 'pilot']) {
      expect(isSigningTolerant(channel)).toBe(true)
      const r = decidePayloadPeCoverage({ channel, mustSign, extracted, signerApproved: approved })
      expect(r.ok, channel).toBe(true)
      expect(r.proven, channel).toBe(false)
      expect(r.failures, channel).toEqual([])
    }
    expect(isSigningTolerant('public')).toBe(false)
    const pub = decidePayloadPeCoverage({ channel: 'public', mustSign, extracted, signerApproved: approved })
    expect(pub.ok).toBe(false)
    expect(pub.failures.length).toBeGreaterThan(0)
  })

  it('PROVEN when every must-sign PE is extracted, valid, timestamped, approved', () => {
    const extracted = mustSign.map(path => ({ path, extracted: true, signature: valid }))
    const r = decidePayloadPeCoverage({ channel: 'public', mustSign, extracted, signerApproved: approved })
    expect(r.proven).toBe(true)
    expect(r.covered).toBe(3)
    expect(r.failures).toEqual([])
  })

  it('ADVERSARIAL: a PE missing from the payload fails closed', () => {
    const extracted = [
      { path: 'app.exe', extracted: true, signature: valid },
      { path: 'resources/elevate.exe', extracted: false, signature: null },
      { path: 'ffmpeg.dll', extracted: true, signature: valid }
    ]
    const r = decidePayloadPeCoverage({ channel: 'public', mustSign, extracted, signerApproved: approved })
    expect(r.proven).toBe(false)
    expect(r.failures.map(f => f.code)).toContain('pe-not-in-payload')
  })

  it('ADVERSARIAL: an unsigned payload copy fails closed', () => {
    const extracted = [
      { path: 'app.exe', extracted: true, signature: valid },
      { path: 'resources/elevate.exe', extracted: true, signature: null },
      { path: 'ffmpeg.dll', extracted: true, signature: valid }
    ]
    const r = decidePayloadPeCoverage({ channel: 'public', mustSign, extracted, signerApproved: approved })
    expect(r.proven).toBe(false)
    expect(r.failures.map(f => f.code)).toContain('pe-inside-unsigned')
  })

  it('ADVERSARIAL: an unapproved signer fails closed', () => {
    const extracted = mustSign.map(path => ({ path, extracted: true, signature: valid }))
    const r = decidePayloadPeCoverage({ channel: 'public', mustSign, extracted, signerApproved: () => false })
    expect(r.proven).toBe(false)
    expect(r.failures.map(f => f.code)).toContain('pe-inside-publisher-not-approved')
  })

  it('off-box: nothing extractable → not proven, honest not a crash', () => {
    const extracted = extractAndVerifyPayloadPes({ installerPath: 'x.exe', mustSign, extractTo: null, probe: null })
    expect(extracted.every(e => e.extracted === false)).toBe(true)
    const r = decidePayloadPeCoverage({ channel: 'public', mustSign, extracted, signerApproved: approved })
    expect(r.proven).toBe(false)
  })

  it('coverageDigest is order-independent and identity-bound', () => {
    const a = coverageDigest([{ path: 'a.exe', extracted: true, signature: { thumbprint: 'X' } }, { path: 'b.dll', extracted: true, signature: { thumbprint: 'Y' } }])
    const b = coverageDigest([{ path: 'b.dll', extracted: true, signature: { thumbprint: 'Y' } }, { path: 'a.exe', extracted: true, signature: { thumbprint: 'X' } }])
    expect(a).toBe(b)
    const c = coverageDigest([{ path: 'a.exe', extracted: true, signature: { thumbprint: 'Z' } }, { path: 'b.dll', extracted: true, signature: { thumbprint: 'Y' } }])
    expect(a).not.toBe(c)
  })
})

describe('extractAndVerifyPayloadPes — injectable I/O', () => {
  it('invokes extractTo + probe per PE and records the verdict', () => {
    const calls = []
    const extractTo = (inst, inner) => { calls.push(inner); return `/tmp/${inner.replace(/\//g, '_')}` }
    const probe = abs => ({ valid: abs.includes('app'), trustedTimestamp: true })
    const out = extractAndVerifyPayloadPes({ installerPath: 'i.exe', mustSign: ['app.exe', 'x.dll'], extractTo, probe })
    expect(calls).toEqual(['app.exe', 'x.dll'])
    expect(out[0]).toMatchObject({ path: 'app.exe', extracted: true })
    expect(out[0].signature.valid).toBe(true)
    expect(out[1].signature.valid).toBe(false)
  })
})
