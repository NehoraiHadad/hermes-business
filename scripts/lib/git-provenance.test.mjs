import { describe, expect, it } from 'vitest'
import { classifyProvenance, EVIDENCE_ARTIFACT_RE } from './git-provenance.mjs'
import { checkCorrespondence } from './evidence-gates.mjs'

// A deterministic fake git: ancestry + changed paths come from fixture maps, so
// classifyProvenance is exercised with zero dependence on a real repository.
function fakeGit({ ancestors = {}, diffs = {} } = {}) {
  return (args) => {
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
      if (!ancestors[`${args[2]}->${args[3]}`]) throw new Error('not an ancestor')
      return ''
    }
    if (args[0] === 'diff' && args[1] === '--name-only') {
      return (diffs[`${args[2]}->${args[3]}`] || []).join('\n')
    }
    throw new Error('unexpected git ' + args.join(' '))
  }
}
const HEAD = 'HEAD1'

describe('classifyProvenance', () => {
  it('equal when git_head is the current HEAD', () => {
    expect(classifyProvenance(HEAD, HEAD, { git: fakeGit() }).relation).toBe('equal')
  })
  it('unknown when git_head is missing or literally "unknown"', () => {
    expect(classifyProvenance('', HEAD, { git: fakeGit() }).relation).toBe('unknown')
    expect(classifyProvenance('unknown', HEAD, { git: fakeGit() }).relation).toBe('unknown')
  })
  it('divergent when git_head is bogus or a non-ancestor', () => {
    expect(classifyProvenance('BOGUS', HEAD, { git: fakeGit({ ancestors: {} }) }).relation).toBe('divergent')
  })
  it('evidence-descendant when only docs/evidence/*.json changed since', () => {
    const git = fakeGit({
      ancestors: { 'BASE->HEAD1': true },
      diffs: { 'BASE->HEAD1': ['docs/evidence/approval.json', 'docs/evidence/packaged-e2e.json'] }
    })
    expect(classifyProvenance('BASE', HEAD, { git }).relation).toBe('evidence-descendant')
  })
  it('code-descendant when any non-envelope path changed (code/subdir/prose)', () => {
    for (const changed of [['src/main.ts'], ['docs/evidence/forensics/raw.txt'], ['docs/evidence/README.md']]) {
      const git = fakeGit({ ancestors: { 'BASE->HEAD1': true }, diffs: { 'BASE->HEAD1': changed } })
      expect(classifyProvenance('BASE', HEAD, { git }).relation).toBe('code-descendant')
    }
  })
  it('code-descendant (fail closed) when the ancestor diff is empty', () => {
    const git = fakeGit({ ancestors: { 'BASE->HEAD1': true }, diffs: { 'BASE->HEAD1': [] } })
    expect(classifyProvenance('BASE', HEAD, { git }).relation).toBe('code-descendant')
  })
  it('divergent (fail closed) when ancestry succeeds but the diff throws', () => {
    // The merge-base ancestry check passes, yet `git diff` fails (corrupt object,
    // git error). The change set is indeterminate, so classifyProvenance must
    // return a fail-closed relation rather than let the throw crash the verifier.
    const git = (args) => {
      if (args[0] === 'merge-base' && args[1] === '--is-ancestor') return ''
      if (args[0] === 'diff' && args[1] === '--name-only') throw new Error('diff exploded')
      throw new Error('unexpected git ' + args.join(' '))
    }
    expect(classifyProvenance('BASE', HEAD, { git }).relation).toBe('divergent')
  })
})

describe('EVIDENCE_ARTIFACT_RE', () => {
  it('matches only top-level docs/evidence JSON envelopes', () => {
    expect(EVIDENCE_ARTIFACT_RE.test('docs/evidence/telegram.json')).toBe(true)
    expect(EVIDENCE_ARTIFACT_RE.test('docs/evidence/schema.json')).toBe(true)
    expect(EVIDENCE_ARTIFACT_RE.test('docs/evidence/README.md')).toBe(false)
    expect(EVIDENCE_ARTIFACT_RE.test('docs/evidence/forensics/x.json')).toBe(false)
    expect(EVIDENCE_ARTIFACT_RE.test('src/evidence.json')).toBe(false)
  })
})

describe('checkCorrespondence relation gate (injected classifier)', () => {
  const current = { app: 'a', range: 'r', git_head: 'HEAD1', cwd: '.' }
  const base = { app_version: 'a', hermes_range: 'r', git_head: 'X' }
  const errs = (git_state, relation) => {
    const out = []
    checkCorrespondence({ ...base, git_state }, current, m => out.push(m), () => ({ relation }))
    return out
  }
  it('committed passes on equal or evidence-descendant, fails otherwise', () => {
    expect(errs('committed', 'equal')).toEqual([])
    expect(errs('committed', 'evidence-descendant')).toEqual([])
    expect(errs('committed', 'code-descendant').join()).toMatch(/not valid for a committed/)
    expect(errs('committed', 'divergent').join()).toMatch(/not valid for a committed/)
  })
  it('working-tree tolerates code-descendant but still rejects bogus/stale heads', () => {
    expect(errs('working-tree', 'code-descendant')).toEqual([])
    expect(errs('working-tree', 'divergent').join()).toMatch(/not valid for a working-tree/)
    expect(errs('working-tree', 'unknown').join()).toMatch(/not valid for a working-tree/)
  })
})
