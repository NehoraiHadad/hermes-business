import { afterAll, describe, expect, it } from 'vitest'
import { buildEnvelope } from './evidence.mjs'
import { verifyEvidence } from '../verify-evidence.mjs'
import {
  scratchDir, cleanupScratch, writeEnvelope as write,
  passingPackaged, passingApproval
} from './evidence-fixtures.mjs'

afterAll(cleanupScratch)

describe('anti-false-pass proof gate', () => {
  it('accepts a packaged-e2e pass that carries every proof boolean', () => {
    const dir = scratchDir()
    write(dir, 'packaged-e2e.json', buildEnvelope('packaged-e2e', passingPackaged(), { tool: 't' }))
    expect(verifyEvidence({ dir }).ok).toBe(true)
  })

  it('rejects a packaged-e2e pass with live_home_untouched=false', () => {
    const dir = scratchDir()
    write(dir, 'packaged-e2e.json', buildEnvelope('packaged-e2e', { ...passingPackaged(), live_home_untouched: false }, { tool: 't' }))
    expect(verifyEvidence({ dir }).errors.join()).toMatch(/live_home_untouched/)
  })

  it('rejects a packaged-e2e pass whose isolated_session_count is not 0', () => {
    const dir = scratchDir()
    write(dir, 'packaged-e2e.json', buildEnvelope('packaged-e2e', { ...passingPackaged(), isolated_session_count: 3 }, { tool: 't' }))
    expect(verifyEvidence({ dir }).errors.join()).toMatch(/isolated_session_count/)
  })

  it('rejects a packaged-e2e pass with live_config_unchanged=false', () => {
    const dir = scratchDir()
    write(dir, 'packaged-e2e.json', buildEnvelope('packaged-e2e', { ...passingPackaged(), live_config_unchanged: false }, { tool: 't' }))
    expect(verifyEvidence({ dir }).errors.join()).toMatch(/live_config_unchanged/)
  })

  it('rejects a packaged-e2e pass with live_marker_stable_equal=false (recursive fingerprint moved)', () => {
    const dir = scratchDir()
    write(dir, 'packaged-e2e.json', buildEnvelope('packaged-e2e', { ...passingPackaged(), live_marker_stable_equal: false }, { tool: 't' }))
    expect(verifyEvidence({ dir }).errors.join()).toMatch(/live_marker_stable_equal/)
  })

  it('rejects a packaged-e2e pass that omits live_marker_stable_equal entirely', () => {
    const dir = scratchDir()
    const bad = passingPackaged()
    delete bad.live_marker_stable_equal
    write(dir, 'packaged-e2e.json', buildEnvelope('packaged-e2e', bad, { tool: 't' }))
    expect(verifyEvidence({ dir }).errors.join()).toMatch(/live_marker_stable_equal/)
  })

  it('rejects a packaged-e2e pass whose live_unsafe_entries is not 0 (unsafe entry present)', () => {
    const dir = scratchDir()
    write(dir, 'packaged-e2e.json', buildEnvelope('packaged-e2e', { ...passingPackaged(), live_unsafe_entries: 1 }, { tool: 't' }))
    expect(verifyEvidence({ dir }).errors.join()).toMatch(/live_unsafe_entries/)
  })

  it('rejects a packaged-e2e pass missing the build_nonce binding (finding 4)', () => {
    const dir = scratchDir()
    const bad = passingPackaged()
    delete bad.build_nonce
    write(dir, 'packaged-e2e.json', buildEnvelope('packaged-e2e', bad, { tool: 't' }))
    expect(verifyEvidence({ dir }).errors.join()).toMatch(/build_nonce/)
  })

  it('accepts an approval pass that traversed the real event path', () => {
    const dir = scratchDir()
    write(dir, 'approval.json', buildEnvelope('approval', passingApproval(), { tool: 't' }))
    expect(verifyEvidence({ dir }).ok).toBe(true)
  })

  it('rejects an approval pass that was not isolated (runtime not qa-isolated)', () => {
    const dir = scratchDir()
    const bad = passingApproval()
    bad.live_ui_denial_probe.isolated_runtime = false
    write(dir, 'approval.json', buildEnvelope('approval', bad, { tool: 't' }))
    expect(verifyEvidence({ dir }).errors.join()).toMatch(/isolated_runtime/)
  })

  it('rejects an approval pass with a side effect', () => {
    const dir = scratchDir()
    const bad = passingApproval()
    bad.live_ui_denial_probe.no_side_effect = false
    write(dir, 'approval.json', buildEnvelope('approval', bad, { tool: 't' }))
    expect(verifyEvidence({ dir }).errors.join()).toMatch(/no_side_effect/)
  })

  it('rejects an approval pass that faked a renderer modal', () => {
    const dir = scratchDir()
    const bad = passingApproval()
    bad.live_ui_denial_probe.renderer_modal_faked = true
    write(dir, 'approval.json', buildEnvelope('approval', bad, { tool: 't' }))
    expect(verifyEvidence({ dir }).errors.join()).toMatch(/renderer_modal_faked/)
  })
})

describe('retired categories stay retired', () => {
  // Telegram is fully delegated to native Hermes; the category was removed from
  // the contract 2026-08-18. A leftover or hand-authored telegram envelope must
  // be REJECTED as unknown, never silently accepted back into the evidence set.
  it('rejects a telegram envelope as an unknown category', () => {
    const dir = scratchDir()
    // buildEnvelope itself fails closed on retired categories (no subject
    // registry), so forge the category AFTER minting a valid envelope — the
    // shape a stale on-disk telegram.json would actually have.
    const env = buildEnvelope('shared-state', { ok: true }, { tool: 't', status: 'blocked' })
    env.category = 'telegram'
    write(dir, 'telegram.json', env)
    expect(verifyEvidence({ dir }).errors.join()).toMatch(/unknown category "telegram"/)
  })
})
