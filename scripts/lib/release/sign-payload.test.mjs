import { describe, expect, it, vi } from 'vitest'
import { planSigning, signPayload } from './sign-payload.mjs'

const LISTING = ['App.exe', 'resources/elevate.exe', 'ffmpeg.dll', 'App Setup 0.3.3.exe']

describe('planSigning — deterministic order (CRITICAL 2)', () => {
  it('signs helpers/DLLs first and the top-level product exe LAST', () => {
    const { order } = planSigning(['App.exe', 'resources/elevate.exe', 'ffmpeg.dll'])
    expect(order[order.length - 1]).toBe('App.exe')
    expect(order).toContain('resources/elevate.exe')
  })
  it('a justified exclusion is dropped from the sign order', () => {
    const { order, excluded } = planSigning(LISTING, { exclusions: [{ path: 'ffmpeg.dll', reason: 'upstream-signed' }] })
    expect(order).not.toContain('ffmpeg.dll')
    expect(excluded[0].reason).toBe('upstream-signed')
  })
})

describe('signPayload — honest when no signer (CRITICAL 2)', () => {
  it('with NO signer configured it signs nothing and reports it truthfully', () => {
    const r = signPayload({ listing: LISTING, log: { log() {} } })
    expect(r.signed).toBe(false)
    expect(r.signedPaths).toEqual([])
    expect(r.reason).toBe('no-signer-configured')
    // still enumerated the coverage so the operator sees what is unsigned
    expect(r.order.length).toBeGreaterThan(0)
  })
  it('drives signOne over every must-sign PE in order when a signer IS configured', () => {
    const signed = []
    const r = signPayload({ listing: ['App.exe', 'resources/elevate.exe'], resolve: p => `/abs/${p}`, signOne: p => signed.push(p), log: { log() {} } })
    expect(r.signed).toBe(true)
    expect(signed).toEqual(['/abs/resources/elevate.exe', '/abs/App.exe'])
  })
  it('a signer that throws aborts before NSIS (no partial signed shell)', () => {
    const signOne = vi.fn(() => { throw new Error('signtool: cert expired') })
    expect(() => signPayload({ listing: ['resources/elevate.exe', 'App.exe'], signOne, log: { log() {} } })).toThrow(/cert expired/)
    expect(signOne).toHaveBeenCalledTimes(1) // aborted on first failure
  })
})
