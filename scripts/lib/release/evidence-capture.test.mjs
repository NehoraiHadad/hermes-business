import { describe, expect, it } from 'vitest'
import { machineCaptureBinding, assertMachineCaptured, hasManualBindingOverride } from './evidence-capture.mjs'

const NONCE = 'n'.repeat(32)
const rawGood = {
  exact_staged_artifact: true,
  running_nonce: NONCE,
  build_binding: { build_nonce: NONCE, release_binding_digest: 'd'.repeat(64), installer_sha256: 's'.repeat(64) }
}

describe('machineCaptureBinding (HIGH 3)', () => {
  it('derives a machine binding from a real staged-artifact run', () => {
    const r = machineCaptureBinding(rawGood)
    expect(r.ok).toBe(true)
    expect(r.binding).toMatchObject({ build_nonce: NONCE, capture_method: 'machine' })
  })
  it('ADVERSARIAL: a run that did NOT test the exact staged artifact is refused', () => {
    const r = machineCaptureBinding({ ...rawGood, exact_staged_artifact: false })
    expect(r.ok).toBe(false)
    expect(r.binding).toBeNull()
    expect(r.errors.join(' ')).toMatch(/exact immutable staged artifact/)
  })
  it('ADVERSARIAL: running-app nonce != measured artifact nonce (wrong binary)', () => {
    const r = machineCaptureBinding({ ...rawGood, running_nonce: 'OTHER' })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/nonce/)
  })
  it('a missing measured hash yields no binding (fails closed)', () => {
    const r = machineCaptureBinding({ ...rawGood, build_binding: { build_nonce: NONCE } })
    expect(r.ok).toBe(false)
    expect(r.binding).toBeNull()
  })
})

describe('assertMachineCaptured + hasManualBindingOverride (HIGH 3)', () => {
  it('accepts a machine-captured summary', () => {
    expect(assertMachineCaptured({ capture_method: 'machine' })).toEqual([])
  })
  it('ADVERSARIAL: rejects a hand-entered summary (no machine capture)', () => {
    expect(assertMachineCaptured({ build_nonce: NONCE }).map(f => f.code)).toContain('evidence-manual-binding')
  })
  it('ADVERSARIAL: rejects a manual_entry marker even if capture_method claims machine', () => {
    expect(assertMachineCaptured({ capture_method: 'machine', manual_entry: true }).map(f => f.code)).toContain('evidence-manual-binding')
  })
  it('flags a CLI trying to hand-enter any binding field via --extra', () => {
    expect(hasManualBindingOverride(['build_nonce'])).toBe(true)
    expect(hasManualBindingOverride(['release_binding_digest'])).toBe(true)
    expect(hasManualBindingOverride(['capture_method'])).toBe(true)
    expect(hasManualBindingOverride(['reason', 'ran'])).toBe(false)
  })
})
