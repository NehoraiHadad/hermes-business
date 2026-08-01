// Root-classification + walker-bounds coverage for snapshotTree. Real symlink /
// permission failures are unreliable on Windows, so an injected `io` shim forces
// each root condition deterministically; the depth-cap case uses the real fs.
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { countUnsafe, snapshotTree } from './isolated-marker-snapshot.mjs'
import { PROTECTED_POLICY } from './isolated-marker-snapshot-policy.mjs'

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

function ioWith(overrides) {
  const base = {
    lstatSync: () => ({ isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false }),
    readdirSync: () => [],
    readFileSync: () => Buffer.from(''),
    realpath: r => r
  }
  return { ...base, ...overrides }
}
const err = code => Object.assign(new Error(code), { code })

describe('snapshotTree — ROOT classification is fail-closed and absent≠unsafe', () => {
  it('ENOENT / ENOTDIR root is safe-empty (optional tree legitimately absent)', () => {
    for (const code of ['ENOENT', 'ENOTDIR']) {
      const snap = snapshotTree('/root', PROTECTED_POLICY, ioWith({ lstatSync: () => { throw err(code) } }))
      expect(snap).toEqual([])
      expect(countUnsafe(snap)).toBe(0)
    }
  })

  it('an unreadable (EACCES) root is ONE unsafe record, not silently empty', () => {
    const snap = snapshotTree('/root', PROTECTED_POLICY, ioWith({ lstatSync: () => { throw err('EACCES') } }))
    expect(snap).toEqual([{ rel: '.', type: 'unsafe', hash: 'unreadable-root' }])
    expect(countUnsafe(snap)).toBe(1)
  })

  it('a SYMLINK/reparse root is unsafe and is never followed (no traversal)', () => {
    let read = false
    const snap = snapshotTree('/root', PROTECTED_POLICY, ioWith({
      lstatSync: () => ({ isSymbolicLink: () => true, isDirectory: () => false, isFile: () => false }),
      readdirSync: () => { read = true; return ['leaked'] }
    }))
    expect(snap).toEqual([{ rel: '.', type: 'unsafe', hash: 'symlink-root' }])
    expect(read).toBe(false) // the symlinked target was never read
  })

  it('a NON-DIRECTORY root (file/socket) is unsafe, no traversal', () => {
    const snap = snapshotTree('/root', PROTECTED_POLICY, ioWith({
      lstatSync: () => ({ isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true })
    }))
    expect(snap).toEqual([{ rel: '.', type: 'unsafe', hash: 'non-directory-root' }])
  })

  it('an UNRESOLVABLE root (realpath throws) is unsafe, no traversal', () => {
    let read = false
    const snap = snapshotTree('/root', PROTECTED_POLICY, ioWith({
      realpath: () => { throw err('ELOOP') },
      readdirSync: () => { read = true; return [] }
    }))
    expect(snap).toEqual([{ rel: '.', type: 'unsafe', hash: 'unresolvable-root' }])
    expect(read).toBe(false)
  })
})

describe('snapshotTree — bounds enforced INSIDE a wide directory, not only on descent', () => {
  it('a single directory wider than MAX_ENTRIES overflows to unsafe and stops', () => {
    const wide = Array.from({ length: 25000 }, (_, i) => `f${i}`)
    const snap = snapshotTree('/root', PROTECTED_POLICY, ioWith({
      readdirSync: () => wide,
      lstatSync: p => p === '/root'
        ? { isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false }
        : { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true },
      readFileSync: () => Buffer.from('x')
    }))
    expect(snap.some(e => e.type === 'unsafe' && e.hash === 'bounds')).toBe(true)
    expect(snap.length).toBeLessThanOrEqual(20001) // capped, did not push all 25000
  })

  it('a tree deeper than the depth cap yields a deterministic unsafe bounds record', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'snap-root-'))
    created.push(root)
    let p = path.join(root, 'skills')
    for (let i = 0; i < 40; i++) { p = path.join(p, 'd'); mkdirSync(p, { recursive: true }) }
    const snap = snapshotTree(path.join(root, 'skills'))
    expect(snap.some(e => e.type === 'unsafe' && e.hash === 'bounds')).toBe(true)
    expect(countUnsafe(snap)).toBeGreaterThanOrEqual(1)
  })

  it('an absent optional tree is safe-empty (0 unsafe), unlike an unsafe one', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'snap-root-'))
    created.push(root)
    const snap = snapshotTree(path.join(root, 'business'))
    expect(snap).toEqual([])
    expect(countUnsafe(snap)).toBe(0)
  })
})
