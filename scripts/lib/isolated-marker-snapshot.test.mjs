import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { countUnsafe, diffSnapshots, fingerprintTree, snapshotTree } from './isolated-marker-snapshot.mjs'
import { PROTECTED_POLICY, SKILLS_POLICY } from './isolated-marker-snapshot-policy.mjs'

const created = []
afterEach(() => {
  while (created.length) {
    try {
      rmSync(created.pop(), { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

function tree(seed = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'snap-'))
  created.push(root)
  for (const [rel, body] of Object.entries(seed)) {
    const abs = path.join(root, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, body)
  }
  return root
}
const fp = (root, policy) => fingerprintTree(snapshotTree(root, policy))

describe('snapshotTree — content fingerprint closes the size-only holes', () => {
  it('a NESTED file edit (skills/foo/SKILL.md) moves the fingerprint', () => {
    const root = tree({ 'foo/SKILL.md': '# v1', 'foo/code/run.py': 'print(1)' })
    const before = fp(root)
    writeFileSync(path.join(root, 'foo/SKILL.md'), '# v2 — a longer rewritten body')
    expect(fp(root)).not.toBe(before)
  })

  it('a SAME-SIZE nested byte rewrite still moves the fingerprint (hash, not size)', () => {
    const root = tree({ 'plugin/policy.py': 'AAAA' })
    const before = fp(root)
    writeFileSync(path.join(root, 'plugin/policy.py'), 'BBBB') // identical length
    expect(fp(root)).not.toBe(before)
  })

  it('a nested add and a nested remove each move the fingerprint (structural)', () => {
    const root = tree({ 'foo/SKILL.md': '# s' })
    const base = fp(root)
    writeFileSync(path.join(root, 'foo/extra.md'), 'x')
    expect(fp(root)).not.toBe(base)
    rmSync(path.join(root, 'foo/extra.md'))
    rmSync(path.join(root, 'foo/SKILL.md'))
    expect(fp(root)).not.toBe(base)
  })

  it('is deterministic and order-stable across re-reads', () => {
    const root = tree({ 'b/z.md': '2', 'a/y.md': '1', 'a/x.md': '0' })
    expect(fp(root)).toBe(fp(root))
  })

  it('bytecode caches (__pycache__, *.pyc/.pyo) are derived noise in EVERY tree', () => {
    const root = tree({ 'p/policy.py': 'code' })
    const clean = fp(root, PROTECTED_POLICY)
    mkdirSync(path.join(root, 'p/__pycache__'))
    writeFileSync(path.join(root, 'p/__pycache__/policy.cpython-311.pyc'), 'bytecode')
    writeFileSync(path.join(root, 'p/policy.pyc'), 'bytecode')
    writeFileSync(path.join(root, 'p/policy.pyo'), 'bytecode')
    expect(fp(root, PROTECTED_POLICY)).toBe(clean) // bytecode never perturbs any tree
  })

  it('an absent tree is an empty snapshot (durable trees legitimately absent in 0.19.1)', () => {
    const root = tree({})
    expect(snapshotTree(path.join(root, 'workflows'))).toEqual([])
  })
})

describe('snapshotTree — Curator runtime metadata is SKILLS-scoped, not global', () => {
  it('under the skills policy, exact Curator metadata folds to nothing (live churn)', () => {
    const root = tree({ 'foo/SKILL.md': '# s' })
    const clean = fp(root, SKILLS_POLICY)
    writeFileSync(path.join(root, '.curator_state'), 'live')
    writeFileSync(path.join(root, 'foo/.usage.json'), '{"n":1}')
    writeFileSync(path.join(root, 'foo/.usage.json.lock'), '')
    expect(fp(root, SKILLS_POLICY)).toBe(clean) // Curator/learning churn ignored in skills
  })

  it('under the PROTECTED policy, an authored .usage.json IS hashed (plugins/business)', () => {
    const root = tree({ 'p/code.py': 'code' })
    const before = fp(root, PROTECTED_POLICY)
    writeFileSync(path.join(root, 'p/.usage.json'), '{"n":1}') // authored, NOT skills churn
    const withMeta = fp(root, PROTECTED_POLICY)
    expect(withMeta).not.toBe(before) // .usage.json outside skills perturbs the digest
    writeFileSync(path.join(root, 'p/.usage.json'), '{"n":9}') // same-size rewrite
    expect(fp(root, PROTECTED_POLICY)).not.toBe(withMeta) // bytes, not size
  })

  it('a non-allowlisted dotfile (.env) is hashed even under the skills policy', () => {
    const root = tree({ 'plugin/code.py': 'code' })
    writeFileSync(path.join(root, 'plugin/.curator_state'), 'live')
    const withMeta = fp(root, SKILLS_POLICY)
    writeFileSync(path.join(root, 'plugin/.env'), 'K=aaaa') // authored, never allowlisted
    const withEnv = fp(root, SKILLS_POLICY)
    expect(withEnv).not.toBe(withMeta)
    writeFileSync(path.join(root, 'plugin/.env'), 'K=bbbb') // identical length rewrite
    expect(fp(root, SKILLS_POLICY)).not.toBe(withEnv) // same-size rewrite still flips
  })
})

describe('snapshotTree — fail-closed on unsafe entries, never traverses out', () => {
  it('flags a symlink/junction as unsafe and does NOT follow it', () => {
    const outside = tree({ 'secret.md': 'do-not-read' })
    const root = tree({ 'foo/SKILL.md': '# s' })
    let linked = false
    for (const type of ['junction', 'dir']) {
      try {
        symlinkSync(outside, path.join(root, 'foo/link'), type)
        linked = true
        break
      } catch {
        /* try next / skip if unprivileged */
      }
    }
    if (!linked) return // symlink creation not permitted here — nothing to assert
    const snap = snapshotTree(root)
    expect(countUnsafe(snap)).toBeGreaterThanOrEqual(1)
    const link = snap.find(e => e.rel === 'foo/link')
    expect(link.type).toBe('unsafe')
    // The linked target's file must never appear in the walk (no traversal out).
    expect(snap.some(e => e.rel.includes('secret.md'))).toBe(false)
  })
})

describe('diffSnapshots — structural vs content kept separate, counts only', () => {
  it('separates a same-path byte rewrite (content) from an add (structural)', () => {
    const root = tree({ 'a.md': 'AAAA' })
    const before = snapshotTree(root)
    writeFileSync(path.join(root, 'a.md'), 'BBBB') // content
    writeFileSync(path.join(root, 'b.md'), 'new') // structural add
    const d = diffSnapshots(before, snapshotTree(root))
    expect(d).toEqual({ structural: 1, content: 1 })
  })

  it('reports zero drift for an unchanged tree', () => {
    const root = tree({ 'a.md': '1', 'sub/b.md': '2' })
    const s = snapshotTree(root)
    expect(diffSnapshots(s, snapshotTree(root))).toEqual({ structural: 0, content: 0 })
  })
})
