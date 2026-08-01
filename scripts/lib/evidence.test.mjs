import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildEnvelope, redactDeep, redactPaths, appVersion, hermesRange, gitInfo } from './evidence.mjs'
import { verifyEvidence } from '../verify-evidence.mjs'

const tmpDirs = []
function scratchDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'evidence-test-'))
  tmpDirs.push(dir)
  return dir
}
afterAll(() => tmpDirs.forEach(d => rmSync(d, { recursive: true, force: true })))

describe('redaction', () => {
  it('strips emails, secret shapes and absolute user paths from nested data', () => {
    const dirty = {
      email: 'owner jane@acme.com',
      key: 'sk-ABCDEFGHIJKL0123',
      winPath: 'C:\\Users\\alice\\hermes\\state.db',
      homePath: os.homedir() + '/secret',
      ok: true,
      count: 3
    }
    const clean = redactDeep(dirty)
    expect(clean.email).toBe('owner <redacted>@acme.com')
    expect(clean.key).toBe('<redacted>')
    expect(clean.winPath).toBe('<path>')
    expect(clean.homePath).toContain('<home>')
    expect(clean.ok).toBe(true)
    expect(clean.count).toBe(3)
  })

  it('redactPaths collapses temp and home directories', () => {
    expect(redactPaths(os.tmpdir() + '\\hermes-e2e-home-x')).toContain('<tmp>')
    expect(redactPaths('/home/bob/x')).toContain('<home>')
  })
})

describe('buildEnvelope', () => {
  it('stamps the current app version, hermes range and git state', () => {
    const env = buildEnvelope('shared-state', { ok: true }, { tool: 't' })
    expect(env.schema_version).toBe(1)
    expect(env.app_version).toBe(appVersion())
    expect(env.hermes_range).toBe(hermesRange())
    expect(['committed', 'working-tree']).toContain(env.git_state)
    expect(env.redacted).toBe(true)
  })
})

describe('verifyEvidence', () => {
  function write(dir, name, env) {
    writeFileSync(path.join(dir, name), JSON.stringify(env, null, 2))
  }

  it('accepts a well-formed, redacted, corresponding envelope', () => {
    const dir = scratchDir()
    write(dir, 'shared-state.json', buildEnvelope('shared-state', { ok: true, count: 2 }, { tool: 't' }))
    const result = verifyEvidence({ dir })
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects an app_version that does not match the current tree', () => {
    const dir = scratchDir()
    const env = buildEnvelope('shared-state', { ok: true }, { tool: 't' })
    env.app_version = '9.9.9'
    write(dir, 'shared-state.json', env)
    expect(verifyEvidence({ dir }).ok).toBe(false)
  })

  it('rejects a leaked email or secret in the summary', () => {
    const dir = scratchDir()
    // Bypass buildEnvelope's redaction to simulate a raw leak reaching disk.
    const env = buildEnvelope('shared-state', { ok: true }, { tool: 't' })
    env.summary = { note: 'contact jane@acme.com' }
    write(dir, 'shared-state.json', env)
    const result = verifyEvidence({ dir })
    expect(result.ok).toBe(false)
    expect(result.errors.join()).toMatch(/email|redacted/)
  })

  it('rejects a committed envelope whose git_head is not HEAD, but allows working-tree', () => {
    const dir = scratchDir()
    const committed = buildEnvelope('shared-state', { ok: true }, { tool: 't' })
    committed.git_state = 'committed'
    committed.git_head = '0'.repeat(40)
    write(dir, 'shared-state.json', committed)
    expect(verifyEvidence({ dir }).ok).toBe(false)

    const workingTree = buildEnvelope('shared-state', { ok: true }, { tool: 't' })
    workingTree.git_state = 'working-tree'
    workingTree.git_head = '0'.repeat(40)
    write(dir, 'shared-state.json', workingTree)
    expect(verifyEvidence({ dir }).ok).toBe(true)
  })
})

describe('anti-false-pass proof gate', () => {
  function write(dir, name, env) {
    writeFileSync(path.join(dir, name), JSON.stringify(env, null, 2))
  }
  const passingPackaged = () => ({
    ran: true,
    artifact_attested: true,
    artifact_kind: 'win-unpacked-current',
    qa_namespace_applied: true,
    isolated_runtime: true,
    ws_on_isolated_port: true,
    isolated_session_count: 0,
    isolated_home_populated: true,
    live_home_untouched: true,
    live_config_unchanged: true,
    no_residual: true
  })
  const passingApproval = () => ({
    wiring: { official_method: 'approval.respond', competing_engine: false, delegates_to_official: true },
    unit_coverage: true,
    live_ui_denial_probe: {
      status: 'passed',
      artifact_attested: true,
      qa_namespace_applied: true,
      isolated_runtime: true,
      via_real_event_path: true,
      requested: true,
      denied: true,
      no_side_effect: true,
      renderer_modal_faked: false
    }
  })

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

  it('accepts an approval pass that traversed the real event path', () => {
    const dir = scratchDir()
    write(dir, 'approval.json', buildEnvelope('approval', passingApproval(), { tool: 't' }))
    expect(verifyEvidence({ dir }).ok).toBe(true)
  })

  it('rejects a packaged-e2e pass with live_config_unchanged=false', () => {
    const dir = scratchDir()
    write(dir, 'packaged-e2e.json', buildEnvelope('packaged-e2e', { ...passingPackaged(), live_config_unchanged: false }, { tool: 't' }))
    expect(verifyEvidence({ dir }).errors.join()).toMatch(/live_config_unchanged/)
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

describe('committed evidence tree', () => {
  it('every file under docs/evidence verifies (or the dir is empty pre-capture)', () => {
    const result = verifyEvidence()
    // If no evidence has been captured yet the verifier reports it; once present,
    // all envelopes must pass schema + redaction + correspondence.
    if (result.files.length > 0) {
      expect(result.errors).toEqual([])
      expect(result.ok).toBe(true)
    }
  })
})
