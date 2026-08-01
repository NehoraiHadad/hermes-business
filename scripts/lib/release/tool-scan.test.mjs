import { describe, expect, it } from 'vitest'
import { scanToolTree, looksLikePe, findCacheTools, whichOnPath, byVersionDesc } from './tool-scan.mjs'

// The REAL electron-builder 26 layout: version folders sit DIRECTLY under the Cache
// root (`Cache/7zip@<ver>/…/bin/7za.exe`) — NOT under a fixed `Cache/7zip` subdir
// (the original bug). Unrelated tool folders (nsis, winCodeSign) prove non-7zip
// folders are skipped and the winCodeSign signtool is never mistaken for a 7za.
export const CACHE = 'C:/AppData/electron-builder/Cache'
export const TREE = {
  [CACHE]: [
    { name: '7zip@24.09', dir: true }, { name: '7zip@22.01', dir: true },
    { name: 'nsis-3.0.4.1', dir: true }, { name: 'winCodeSign', dir: true }, { name: 'downloads', dir: true }
  ],
  [`${CACHE}/7zip@24.09`]: [{ name: '7zip-win-x64-a34pt', dir: true }],
  [`${CACHE}/7zip@24.09/7zip-win-x64-a34pt`]: [{ name: 'bin', dir: true }],
  [`${CACHE}/7zip@24.09/7zip-win-x64-a34pt/bin`]: [{ name: '7za.exe', dir: false }],
  [`${CACHE}/7zip@22.01`]: [{ name: 'bin', dir: true }],
  [`${CACHE}/7zip@22.01/bin`]: [{ name: '7za.exe', dir: false }],
  [`${CACHE}/winCodeSign`]: [{ name: 'signtool.exe', dir: false }]
}
export const fakeReaddir = d => (TREE[d.replace(/\\/g, '/')] || []).map(e => ({ name: e.name, isDirectory: e.dir }))
export const treeExists = p => {
  const q = p.replace(/\\/g, '/')
  return Object.keys(TREE).includes(q) || /7za\.exe$/.test(q) || q === '/vendor/signtool.exe' || q === '/usr/bin/signtool.exe'
}
export const NEW = `${CACHE}/7zip@24.09/7zip-win-x64-a34pt/bin/7za.exe`
export const OLD = `${CACHE}/7zip@22.01/bin/7za.exe`

describe('findCacheTools — recursive cache-ROOT scan (root-cause fix)', () => {
  it('finds versioned 7za directly under the Cache root, newest-first, skips non-7zip folders', () => {
    const hits = findCacheTools({ cacheRoot: CACHE, exists: treeExists, readdir: fakeReaddir }).map(h => h.replace(/\\/g, '/'))
    expect(hits[0]).toBe(NEW)
    expect(hits).toContain(OLD)
    expect(hits.some(h => /winCodeSign/.test(h))).toBe(false)
  })
  it('missing cache root → [] (no throw)', () => {
    expect(findCacheTools({ cacheRoot: CACHE, exists: () => false, readdir: fakeReaddir })).toEqual([])
    expect(findCacheTools({ cacheRoot: null })).toEqual([])
  })
})

describe('scanToolTree — bounded recursion', () => {
  it('finds a nested `…/bin/7za.exe`', () => {
    const hits = scanToolTree({ dir: `${CACHE}/7zip@24.09`, filename: '7za.exe', readdir: fakeReaddir })
    expect(hits.map(h => h.replace(/\\/g, '/'))).toContain(NEW)
  })
  it('respects maxDepth', () => {
    expect(scanToolTree({ dir: `${CACHE}/7zip@24.09`, filename: '7za.exe', readdir: fakeReaddir, maxDepth: 1 })).toEqual([])
  })
})

describe('whichOnPath — bare name → ABSOLUTE path (cross-platform)', () => {
  it('resolves via PATH + PATHEXT on Windows-style env', () => {
    const exists = p => p.replace(/\\/g, '/') === 'C:/tools/7za.EXE'
    const p = whichOnPath('7za', { pathEnv: 'C:\\other;C:\\tools', pathext: '.COM;.EXE', sep: ';', exists })
    expect(p.replace(/\\/g, '/')).toBe('C:/tools/7za.EXE')
  })
  it('resolves an extension-less POSIX binary (no PATHEXT)', () => {
    const join = (a, b) => `${a}/${b}` // posix-style join, host-independent
    const exists = p => p === '/usr/local/bin/7za'
    expect(whichOnPath('7za', { pathEnv: '/usr/bin:/usr/local/bin', pathext: '', sep: ':', exists, join })).toBe('/usr/local/bin/7za')
  })
  it('returns null when nothing on PATH resolves (fail closed)', () => {
    expect(whichOnPath('7za', { pathEnv: '/nope', pathext: '', sep: ':', exists: () => false, join: (a, b) => `${a}/${b}` })).toBeNull()
  })
})

describe('byVersionDesc', () => {
  it('orders numeric-aware newest-first', () => {
    expect([OLD, NEW].sort(byVersionDesc)[0]).toBe(NEW)
  })
})

describe('looksLikePe — MZ identity', () => {
  it('accepts MZ-prefixed bytes, rejects others', () => {
    expect(looksLikePe('x', () => Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).toBe(true)
    expect(looksLikePe('x', () => Buffer.from([0x7f, 0x45, 0x4c, 0x46]))).toBe(false)
    expect(looksLikePe('x', () => { throw new Error('unreadable') })).toBe(false)
  })
})
