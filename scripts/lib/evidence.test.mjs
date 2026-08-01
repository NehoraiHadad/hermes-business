import os from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import { buildEnvelope, redactDeep, redactPaths, appVersion, hermesRange } from './evidence.mjs'
import { verifyEvidence } from '../verify-evidence.mjs'
import { scratchDir, cleanupScratch, writeEnvelope as write } from './evidence-fixtures.mjs'

afterAll(cleanupScratch)

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
