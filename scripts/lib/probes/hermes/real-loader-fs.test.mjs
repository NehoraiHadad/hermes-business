import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createSandbox,
  createTempDir,
  isStrictlyUnder,
  osTempRoot,
  pathKey,
  recoveryRoot,
  removeOwnedDir,
  sweepStaleSandboxes,
  verifyElectronUserDataUsed
} from './real-loader-fs.mjs'

const owned = []
afterEach(() => {
  for (const dir of owned.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('real-loader-fs path safety', () => {
  it('pathKey canonicalizes case + trailing separators', () => {
    expect(pathKey('C:\\Foo\\Bar\\')).toBe(pathKey('c:/foo/bar'))
  })

  it('isStrictlyUnder rejects equal/outside paths and sibling-prefixes, accepts children', () => {
    const root = osTempRoot()
    expect(isStrictlyUnder(root, root)).toBe(false)
    expect(isStrictlyUnder(path.join(root, 'child'), root)).toBe(true)
    expect(isStrictlyUnder(path.resolve(root, '..'), root)).toBe(false)
    expect(isStrictlyUnder(`${root}-evil`, root)).toBe(false)
  })

  it('createSandbox lays out every isolated dir (incl. re-homed cache/config) under one root', () => {
    const s = createSandbox('hermes-fs-test-')
    owned.push(s.root)
    for (const key of ['hermesHome', 'userData', 'cwd', 'userProfile', 'appData', 'localAppData', 'tmp', 'xdgConfig', 'xdgCache', 'xdgData']) {
      expect(isStrictlyUnder(s[key], s.root)).toBe(true)
      expect(existsSync(s[key])).toBe(true)
    }
  })

  it('recoveryRoot is a stable dir OUTSIDE any sandbox root', () => {
    const rec = recoveryRoot()
    expect(existsSync(rec)).toBe(true)
    const s = createSandbox('hermes-fs-test-')
    owned.push(s.root)
    expect(isStrictlyUnder(rec, s.root)).toBe(false)
  })
})

describe('real-loader-fs cleanup control flow', () => {
  it('removeOwnedDir refuses paths outside the OS temp root', () => {
    const outside = mkdtempSync(path.join(os.homedir(), '.hermes-fs-outside-'))
    owned.push(outside)
    const result = removeOwnedDir(outside)
    expect(result.removed).toBe(false)
    expect(result.safe).toBe(false)
    expect(existsSync(outside)).toBe(true) // untouched
  })

  it('removeOwnedDir deletes an owned temp tree and treats absent as removed', () => {
    const dir = createTempDir('hermes-fs-test-')
    writeFileSync(path.join(dir, 'f.txt'), 'x')
    expect(removeOwnedDir(dir).removed).toBe(true)
    expect(existsSync(dir)).toBe(false)
    expect(removeOwnedDir(dir).removed).toBe(true) // idempotent
  })

  it('verifyElectronUserDataUsed requires a KNOWN Electron marker, not merely a non-empty dir', () => {
    const dir = createTempDir('hermes-fs-test-')
    owned.push(dir)
    expect(verifyElectronUserDataUsed(dir).used).toBe(false)
    // A non-empty dir with NO known marker still is not accepted.
    writeFileSync(path.join(dir, 'random.bin'), 'x')
    expect(verifyElectronUserDataUsed(dir).used).toBe(false)
    mkdirSync(path.join(dir, 'Local Storage'), { recursive: true })
    writeFileSync(path.join(dir, 'Preferences'), '{}')
    const used = verifyElectronUserDataUsed(dir)
    expect(used.used).toBe(true)
    expect(used.markers).toContain('Local Storage')
    expect(used.markers).toContain('Preferences')
    expect(verifyElectronUserDataUsed(path.join(dir, 'missing')).used).toBe(false)
  })
})

describe('real-loader-fs generic stale-sandbox sweep', () => {
  it('removes only old, correctly-prefixed sandboxes and never the live/keep root', () => {
    const stale = mkdtempSync(path.join(os.tmpdir(), 'hermes-realloader-'))
    const fresh = mkdtempSync(path.join(os.tmpdir(), 'hermes-realloader-'))
    const foreign = mkdtempSync(path.join(os.tmpdir(), 'unrelated-'))
    owned.push(fresh, foreign)
    // Age the stale one past the threshold.
    const old = new Date(Date.now() - 7_200_000)
    utimesSync(stale, old, old)

    const results = sweepStaleSandboxes({ maxAgeMs: 3_600_000, keep: fresh })
    const byTarget = Object.fromEntries(results.map(r => [pathKey(r.target), r]))
    expect(byTarget[pathKey(stale)]?.removed).toBe(true)
    expect(existsSync(stale)).toBe(false)
    // Fresh (the keep root) is skipped entirely; foreign prefix never considered.
    expect(existsSync(fresh)).toBe(true)
    expect(byTarget[pathKey(foreign)]).toBeUndefined()
    expect(existsSync(foreign)).toBe(true)
  })

  it('never sweeps the durable recovery dir', () => {
    const rec = recoveryRoot()
    const old = new Date(Date.now() - 7_200_000)
    try {
      utimesSync(rec, old, old)
    } catch {
      /* fine */
    }
    const results = sweepStaleSandboxes({ maxAgeMs: 3_600_000 })
    expect(results.find(r => pathKey(r.target) === pathKey(rec))).toBeUndefined()
    expect(existsSync(rec)).toBe(true)
  })
})
