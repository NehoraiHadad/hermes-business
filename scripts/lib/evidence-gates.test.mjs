import { afterAll, describe, expect, it } from 'vitest'
import { buildEnvelope } from './evidence.mjs'
import { reduceTelegram } from './evidence-reducers.mjs'
import { verifyEvidence } from '../verify-evidence.mjs'
import {
  scratchDir, cleanupScratch, writeEnvelope as write,
  passingPackaged, passingApproval, passingTelegram
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

describe('telegram round-trip proof gate', () => {
  it('reduceTelegram keeps only scalar booleans/counts/enums (no IDs or content)', () => {
    const s = reduceTelegram(passingTelegram())
    expect(s.diagnosis.connection_mode).toBe('polling')
    expect(s.diagnosis.pending_update_count).toBe(0)
    expect(s.roundtrip.other_chats_touched).toBe(0)
    // every nested value is a scalar (string/number/boolean/null), never an object with ids
    for (const group of [s.diagnosis, s.fix, s.roundtrip]) {
      for (const v of Object.values(group)) expect(['string', 'number', 'boolean']).toContain(typeof v)
    }
  })

  it('accepts a telegram pass that carries every proof boolean', () => {
    const dir = scratchDir()
    write(dir, 'telegram.json', buildEnvelope('telegram', reduceTelegram(passingTelegram()), { tool: 't' }))
    expect(verifyEvidence({ dir }).ok).toBe(true)
  })

  it('rejects a telegram pass with a webhook present (poller conflict risk)', () => {
    const dir = scratchDir()
    const bad = passingTelegram(); bad.diagnosis.webhook_present = true
    write(dir, 'telegram.json', buildEnvelope('telegram', reduceTelegram(bad), { tool: 't' }))
    expect(verifyEvidence({ dir }).errors.join()).toMatch(/webhook_present/)
  })

  it('rejects a telegram pass that mutated config or env', () => {
    const dir = scratchDir()
    const bad = passingTelegram(); bad.fix.config_mutated = true
    write(dir, 'telegram.json', buildEnvelope('telegram', reduceTelegram(bad), { tool: 't' }))
    expect(verifyEvidence({ dir }).errors.join()).toMatch(/config_mutated/)
  })

  it('rejects a telegram pass that touched another chat', () => {
    const dir = scratchDir()
    const bad = passingTelegram(); bad.roundtrip.other_chats_touched = 1
    write(dir, 'telegram.json', buildEnvelope('telegram', reduceTelegram(bad), { tool: 't' }))
    expect(verifyEvidence({ dir }).errors.join()).toMatch(/other_chats_touched/)
  })

  it('rejects a telegram pass where inbound never reached Hermes', () => {
    const dir = scratchDir()
    const bad = passingTelegram(); bad.diagnosis.inbound_reached_hermes = false
    write(dir, 'telegram.json', buildEnvelope('telegram', reduceTelegram(bad), { tool: 't' }))
    expect(verifyEvidence({ dir }).errors.join()).toMatch(/inbound_reached_hermes/)
  })

  it('rejects a telegram pass whose authorized reply was not delivered', () => {
    const dir = scratchDir()
    const bad = passingTelegram(); bad.roundtrip.outbound_delivered = false
    write(dir, 'telegram.json', buildEnvelope('telegram', reduceTelegram(bad), { tool: 't' }))
    expect(verifyEvidence({ dir }).errors.join()).toMatch(/outbound_delivered/)
  })
})
