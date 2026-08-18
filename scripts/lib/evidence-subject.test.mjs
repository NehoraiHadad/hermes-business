import { afterEach, afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkSubjectFreshness, subjectFingerprint } from './evidence-subject.mjs'
import { hashSubjects } from './subject-hash.mjs'
import { SUBJECT_SCHEME } from './subject-registry.mjs'
import { buildEnvelope } from './evidence.mjs'
import { verifyEvidence } from '../verify-evidence.mjs'
import { scratchDir, cleanupScratch, writeEnvelope as write } from './evidence-fixtures.mjs'
import { passingPackaged } from './evidence-fixtures.mjs'

afterAll(cleanupScratch)

const created = []
function put(root, rel, body) {
  const abs = path.join(root, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, body)
}
function tmpRoot(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'evsubj-'))
  created.push(root)
  for (const [rel, body] of Object.entries(files)) put(root, rel, body)
  return root
}
afterEach(() => {
  while (created.length) {
    try {
      rmSync(created.pop(), { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

function collect(env, root, compute) {
  const errors = []
  checkSubjectFreshness(env, root, e => errors.push(e), compute)
  return errors
}
const passed = (fp, over = {}) => ({
  category: 'shared-state', status: 'passed', subject_scheme: SUBJECT_SCHEME, subject_fingerprint: fp, ...over
})

describe('subject freshness — drift semantics', () => {
  // A controlled root standing in for the repo: `code/` is the attested subject,
  // `docs/evidence/` is the evidence output (in NO subject set).
  const files = { 'code/app.js': 'v1', 'docs/evidence/shared-state.json': '{"status":"passed"}' }
  const compute = (root /* , cat */) => hashSubjects(root, [{ dir: 'code' }], { scheme: SUBJECT_SCHEME })

  it('accepts a passed envelope whose attested subjects are unchanged', () => {
    const root = tmpRoot(files)
    const env = passed(compute(root).fingerprint)
    expect(collect(env, root, compute)).toEqual([])
  })

  it('an evidence-only edit does NOT self-invalidate the pass', () => {
    const root = tmpRoot(files)
    const env = passed(compute(root).fingerprint)
    put(root, 'docs/evidence/shared-state.json', '{"status":"passed","note":"refreshed"}')
    expect(collect(env, root, compute)).toEqual([]) // evidence output is not a subject
  })

  it('RELEVANT subject drift rejects the pass with a recapture hint', () => {
    const root = tmpRoot(files)
    const env = passed(compute(root).fingerprint)
    put(root, 'code/app.js', 'v2') // the attested code changed
    const errors = collect(env, root, compute)
    expect(errors.join()).toMatch(/subject drift/)
    expect(errors.join()).toMatch(/recapture/)
  })

  it('fails CLOSED when the attested subjects are missing/unreadable', () => {
    const root = tmpRoot({ 'docs/evidence/x.json': '{}' }) // no code/ dir at all
    const env = passed('a'.repeat(64))
    expect(collect(env, root, compute).join()).toMatch(/fail closed|missing/)
  })
})

describe('subject freshness — anti-masquerade & scope', () => {
  const compute = (root /* , cat */) => hashSubjects(root, [{ dir: 'code' }], { scheme: SUBJECT_SCHEME })

  it('a passed envelope with NO subject_fingerprint is rejected (legacy cannot pass)', () => {
    const root = tmpRoot({ 'code/app.js': 'v1' })
    const env = passed(undefined)
    delete env.subject_fingerprint
    expect(collect(env, root, compute).join()).toMatch(/no valid subject_fingerprint/)
  })

  it('a passed envelope stamped with an OLD subject_scheme is rejected', () => {
    const root = tmpRoot({ 'code/app.js': 'v1' })
    const env = passed(compute(root).fingerprint, { subject_scheme: 0 })
    expect(collect(env, root, compute).join()).toMatch(/subject_scheme/)
  })

  it('a passed envelope for an unknown category fails closed', () => {
    const root = tmpRoot({ 'code/app.js': 'v1' })
    const env = passed('a'.repeat(64), { category: 'made-up' })
    expect(collect(env, root, compute).join()).toMatch(/no subject registry/)
  })

  it('blocked / skipped envelopes are NOT held to a subject fingerprint', () => {
    const root = tmpRoot({}) // no subjects present at all
    for (const status of ['blocked', 'skipped']) {
      expect(collect({ category: 'thin-installer', status }, root, compute)).toEqual([])
    }
  })
})

describe('subject freshness — end-to-end through verifyEvidence over the real repo', () => {
  it('accepts a freshly-stamped passed envelope', () => {
    const dir = scratchDir()
    // buildEnvelope stamps the CURRENT subject fingerprint; the verifier recomputes
    // the same over the working tree → match.
    write(dir, 'packaged-e2e.json', buildEnvelope('packaged-e2e', passingPackaged(), { tool: 't' }))
    expect(verifyEvidence({ dir }).ok).toBe(true)
  })

  it('rejects a legacy passed envelope that lacks subject_fingerprint, explaining recapture', () => {
    const dir = scratchDir()
    const env = buildEnvelope('packaged-e2e', passingPackaged(), { tool: 't' })
    delete env.subject_fingerprint
    delete env.subject_scheme
    write(dir, 'packaged-e2e.json', env)
    const result = verifyEvidence({ dir })
    expect(result.ok).toBe(false)
    expect(result.errors.join()).toMatch(/recapture/)
  })

  it('real per-category fingerprints are deterministic 64-hex digests', () => {
    for (const c of ['packaged-e2e', 'approval', 'shared-state', 'thin-installer']) {
      const a = subjectFingerprint(process.cwd(), c)
      const b = subjectFingerprint(process.cwd(), c)
      expect(a.fingerprint).toBe(b.fingerprint)
      expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})
