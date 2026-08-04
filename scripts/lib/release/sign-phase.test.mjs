import { describe, expect, it } from 'vitest'
import { PACKAGE_STEPS, planPackageOrder, assertHookOrder, rejectUnsignedInsideSignedLoose } from './sign-phase.mjs'

describe('two-phase hook order (CRITICAL 2)', () => {
  it('the canonical plan signs the payload AFTER build:dir and BEFORE nsis', () => {
    const r = assertHookOrder(planPackageOrder('public'), { afterPackSigns: false })
    expect(r.ok).toBe(true)
    expect(r.failures).toEqual([])
    // sanity: order positions
    const s = PACKAGE_STEPS
    expect(s.indexOf('build:dir')).toBeLessThan(s.indexOf('finalize-payload:sign+verify+manifest'))
    expect(s.indexOf('finalize-payload:sign+verify+manifest')).toBeLessThan(s.indexOf('nsis:prepackaged'))
    expect(s.indexOf('nsis:prepackaged')).toBeLessThan(s.indexOf('sign-release:installer'))
  })

  it('ADVERSARIAL: signing inside afterPack is rejected', () => {
    const r = assertHookOrder(planPackageOrder('public'), { afterPackSigns: true })
    expect(r.ok).toBe(false)
    expect(r.failures.map(f => f.code)).toContain('afterpack-signs')
  })

  it('ADVERSARIAL: signing BEFORE the dir build is rejected', () => {
    const bad = ['finalize-payload:sign+verify+manifest', 'build:dir', 'nsis:prepackaged']
    const r = assertHookOrder(bad)
    expect(r.ok).toBe(false)
    expect(r.failures.map(f => f.code)).toContain('sign-before-dir')
  })

  it('ADVERSARIAL: signing AFTER NSIS packs the payload is rejected', () => {
    const bad = ['build:dir', 'nsis:prepackaged', 'finalize-payload:sign+verify+manifest']
    const r = assertHookOrder(bad)
    expect(r.ok).toBe(false)
    expect(r.failures.map(f => f.code)).toContain('sign-after-nsis')
  })
})

describe('unsigned-inside / signed-loose rejection (CRITICAL 2)', () => {
  const valid = { valid: true, trustedTimestamp: true, thumbprint: 'AA' }
  it('rejects a signed installer around an UNSIGNED payload PE', () => {
    const r = rejectUnsignedInsideSignedLoose({
      channel: 'public',
      loose: { installer: valid, app: valid },
      inside: [{ path: 'resources/elevate.exe', signature: null }, { path: 'app.exe', signature: valid }]
    })
    expect(r.ok).toBe(false)
    expect(r.failures[0].code).toBe('unsigned-inside-signed-loose')
    expect(r.failures[0].detail).toMatch(/elevate\.exe/)
  })

  it('accepts when every inside PE is signed', () => {
    const r = rejectUnsignedInsideSignedLoose({
      channel: 'public',
      loose: { installer: valid },
      inside: [{ path: 'app.exe', signature: valid }]
    })
    expect(r.ok).toBe(true)
  })

  it('qa is never blocked (non-distributable regardless)', () => {
    const r = rejectUnsignedInsideSignedLoose({ channel: 'qa', loose: { installer: valid }, inside: [{ path: 'x.dll', signature: null }] })
    expect(r.ok).toBe(true)
  })

  it('pilot is never blocked either (unsigned is expected, disclosed, still distributable)', () => {
    const r = rejectUnsignedInsideSignedLoose({ channel: 'pilot', loose: { installer: valid }, inside: [{ path: 'x.dll', signature: null }] })
    expect(r.ok).toBe(true)
  })
})
