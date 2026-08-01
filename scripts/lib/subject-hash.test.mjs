import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  MissingSubjectError,
  hashSubjects,
  resolveSelector,
  resolveSubjects
} from './subject-hash.mjs'

const created = []
function put(root, rel, body) {
  const abs = path.join(root, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, body)
}
function tmpRoot(files = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'subj-'))
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

describe('resolveSubjects — normalization & ordering', () => {
  it('returns repo-relative FORWARD-SLASH paths, deduped and code-unit sorted', () => {
    const root = tmpRoot({ 'pkg/b.js': '1', 'pkg/a.js': '2', 'pkg/sub/c.js': '3' })
    const files = resolveSubjects(root, [{ dir: 'pkg' }, { file: 'pkg/a.js' }])
    expect(files).toEqual(['pkg/a.js', 'pkg/b.js', 'pkg/sub/c.js'])
    expect(files.every(f => !f.includes('\\'))).toBe(true) // never a Windows backslash
  })

  it('orders Unicode filenames deterministically by code unit (locale-independent)', () => {
    const root = tmpRoot({ 'p/zebra.js': '1', 'p/état.js': '2', 'p/apple.js': '3', 'p/עברית.js': '4' })
    const a = resolveSubjects(root, [{ dir: 'p' }])
    const b = resolveSubjects(tmpRoot({ 'p/zebra.js': '1', 'p/état.js': '2', 'p/apple.js': '3', 'p/עברית.js': '4' }), [{ dir: 'p' }])
    expect(a).toEqual(b) // identical ordering regardless of insertion/readdir order
    expect(a).toEqual([...a].sort()) // pure UTF-16 code-unit order
  })
})

describe('hashSubjects — determinism & content sensitivity', () => {
  it('is deterministic and a pure function of content + normalized path', () => {
    const files = { 'a/x.js': 'hello', 'a/y.js': 'world', 'z.txt': 'zz' }
    const h1 = hashSubjects(tmpRoot(files), [{ dir: 'a' }, { file: 'z.txt' }])
    const h2 = hashSubjects(tmpRoot(files), [{ dir: 'a' }, { file: 'z.txt' }])
    expect(h1.fingerprint).toBe(h2.fingerprint)
    expect(h1.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(h1.fileCount).toBe(3)
  })

  it('a content edit to any subject changes the fingerprint', () => {
    const root = tmpRoot({ 'a/x.js': 'hello', 'a/y.js': 'world' })
    const before = hashSubjects(root, [{ dir: 'a' }]).fingerprint
    put(root, 'a/y.js', 'WORLD')
    expect(hashSubjects(root, [{ dir: 'a' }]).fingerprint).not.toBe(before)
  })

  it('bumping the scheme yields a fresh fingerprint namespace for identical files', () => {
    const root = tmpRoot({ 'a/x.js': 'hello' })
    const s1 = hashSubjects(root, [{ dir: 'a' }], { scheme: 1 }).fingerprint
    const s2 = hashSubjects(root, [{ dir: 'a' }], { scheme: 2 }).fingerprint
    expect(s1).not.toBe(s2)
  })

  it('honours exclude and ext filters', () => {
    const root = tmpRoot({ 'a/keep.js': '1', 'a/skip.test.js': '2', 'a/note.md': '3' })
    const filesJs = resolveSubjects(root, [{ dir: 'a', exclude: /\.test\.js$/, exts: ['.js'] }])
    expect(filesJs).toEqual(['a/keep.js'])
  })
})

describe('fail closed on missing subjects', () => {
  it('throws MissingSubjectError for a missing single file', () => {
    const root = tmpRoot({ 'a/x.js': '1' })
    expect(() => resolveSelector(root, { file: 'a/gone.js' })).toThrow(MissingSubjectError)
  })

  it('throws MissingSubjectError for a required directory that resolves to zero files', () => {
    const root = tmpRoot({ 'a/x.js': '1' })
    expect(() => resolveSelector(root, { dir: 'does-not-exist' })).toThrow(/empty or missing/)
    // A dir present but fully excluded is also empty → fail closed, never a pass.
    expect(() => resolveSelector(root, { dir: 'a', exclude: /\.js$/ })).toThrow(MissingSubjectError)
  })
})
