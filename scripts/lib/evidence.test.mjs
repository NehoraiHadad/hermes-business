import os from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import { buildEnvelope, redactDeep, redactPaths, appVersion, hermesRange } from './evidence.mjs'
import { verifyEvidence } from '../verify-evidence.mjs'
import { memoizeProvenance } from './git-provenance.mjs'
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

  it('rejects a bogus/unreachable git_head for BOTH committed and working-tree', () => {
    // The all-zeros hash resolves to no object, so it is neither HEAD nor an
    // ancestor: it classifies as `divergent`, which no git_state accepts, so
    // verification fails closed. Inject the classifier via verifyEvidence's seam
    // rather than letting the default spawn merge-base + diff on a bogus object
    // (a real subprocess that is slow and timing-flaky) — and assert each run
    // gets its OWN fresh memo cache, classifying once and never leaking a result
    // across runs.
    const dir = scratchDir()
    const bogus = '0'.repeat(40)
    let underlying = 0
    const diverge = (head /* , current, opts */) => {
      underlying++
      expect(head).toBe(bogus) // the bogus git_head is what reaches the classifier
      return { relation: 'divergent', changed: [] }
    }
    for (const git_state of ['committed', 'working-tree']) {
      const before = underlying
      const classify = memoizeProvenance(diverge) // fresh per-run cache, as the default is
      const env = buildEnvelope('shared-state', { ok: true }, { tool: 't' })
      env.git_state = git_state
      env.git_head = bogus
      write(dir, 'shared-state.json', env)
      expect(verifyEvidence({ dir, classify }).ok).toBe(false) // divergent → fail closed for both
      expect(underlying - before).toBe(1) // this run's fresh cache classified exactly once
    }
    expect(underlying).toBe(2) // two independent runs, no cross-run cache leakage
  })

  it('accepts a working-tree envelope based on the current HEAD', () => {
    const dir = scratchDir()
    const env = buildEnvelope('shared-state', { ok: true }, { tool: 't' })
    env.git_state = 'working-tree' // git_head is the current HEAD → equal → valid
    write(dir, 'shared-state.json', env)
    expect(verifyEvidence({ dir }).ok).toBe(true)
  })

  it('classifies a shared git_head once across many envelopes (no redundant git)', () => {
    // Regression guard for the O(envelopes) → O(unique heads) provenance batching.
    // Five envelopes share one git_head/current pair; the memoized classifier must
    // invoke the underlying (git-spawning) classifier exactly once for the batch.
    const dir = scratchDir()
    let underlying = 0
    const counting = (head, current, opts) => {
      underlying++
      return { relation: head === current ? 'equal' : 'code-descendant', changed: [] }
    }
    const classify = memoizeProvenance(counting)
    for (let i = 0; i < 5; i++) {
      const env = buildEnvelope('shared-state', { ok: true, count: i }, { tool: 't' })
      env.git_state = 'working-tree' // all share the current HEAD → one pair
      write(dir, `shared-state-${i}.json`, env)
    }
    const result = verifyEvidence({ dir, classify })
    expect(result.ok).toBe(true)
    expect(result.files.length).toBe(5)
    expect(underlying).toBe(1) // classified once for all five, not five times
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
