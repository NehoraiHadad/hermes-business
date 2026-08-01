import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  classifyRoot,
  resolveRoots,
  effectiveRoots,
  persistedRoots,
  mountsFor,
  denyAllSafeRoot
} from './sandbox-roots.cjs'

let home: string
let previousHome: string | undefined

beforeEach(() => {
  previousHome = process.env.HERMES_HOME
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-sandbox-roots-'))
  process.env.HERMES_HOME = home
})

afterEach(() => {
  if (previousHome === undefined) delete process.env.HERMES_HOME
  else process.env.HERMES_HOME = previousHome
  fs.rmSync(home, { recursive: true, force: true })
})

function dir(...parts: string[]) {
  const p = path.join(home, ...parts)
  fs.mkdirSync(p, { recursive: true })
  return p
}

describe('classifyRoot', () => {
  it('accepts an existing absolute directory with Hebrew letters and spaces', () => {
    const p = dir('עסק שלי', 'תיקיית פלט')
    const result = classifyRoot({ path: p, access: 'rw' })
    // path is the canonical real target (equals resolve() for a non-reparse dir).
    expect(result).toMatchObject({ valid: true, access: 'rw', path: fs.realpathSync.native(path.resolve(p)) })
  })

  it('canonicalizes a junction/symlink root to its REAL target, never a link pointing elsewhere', ctx => {
    const target = dir('real-target')
    const link = path.join(home, 'link-root')
    try {
      // Junctions need no elevation on Windows; dir symlinks are used elsewhere.
      fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
    } catch {
      ctx.skip() // OS/permissions cannot create a reparse point here — honest skip.
      return
    }
    const result = classifyRoot({ path: link, access: 'rw' })
    expect(result.valid).toBe(true)
    // The stored/displayed/injected boundary is the resolved target, not the link.
    expect(result.path).toBe(fs.realpathSync.native(target))
    expect(result.reparse).toBe(true)
  })

  it('rejects empty, relative, and parent-escaping paths', () => {
    expect(classifyRoot({ path: '' }).reason).toBe('empty')
    expect(classifyRoot({ path: 'relative/dir' }).reason).toBe('not-absolute')
    // A literal `..` segment (not pre-collapsed by path.join) is an escape.
    expect(classifyRoot({ path: `${home}${path.sep}..${path.sep}escape` }).reason).toBe('parent-escape')
  })

  it('rejects a filesystem/drive root as an allow-all boundary', () => {
    const root = path.parse(home).root
    expect(classifyRoot({ path: root }).reason).toBe('filesystem-root')
  })

  it('rejects a missing path and a file that is not a directory', () => {
    expect(classifyRoot({ path: path.join(home, 'nope') }).reason).toBe('missing')
    const file = path.join(home, 'a-file.txt')
    fs.writeFileSync(file, 'x')
    expect(classifyRoot({ path: file }).reason).toBe('not-a-directory')
  })
})

describe('resolveRoots', () => {
  it('separates valid writable roots from invalid designated writable roots', () => {
    const good = dir('good')
    const settings = {
      roots: [
        { path: good, access: 'rw' },
        { path: path.join(home, 'ghost'), access: 'rw' },
        { path: dir('read'), access: 'ro' }
      ]
    }
    const resolved = resolveRoots(settings)
    expect(resolved.writable).toEqual([fs.realpathSync.native(path.resolve(good))])
    expect(resolved.invalidWritable).toHaveLength(1)
    expect(resolved.invalidWritable[0].reason).toBe('missing')
    expect(resolved.hasDesignatedWritable).toBe(true)
  })
})

describe('effectiveRoots / persistedRoots', () => {
  it('effectiveRoots keeps only valid roots, pinned to the canonical target', () => {
    const good = dir('good')
    const settings = {
      roots: [
        { path: good, access: 'rw' },
        { path: path.join(home, 'ghost'), access: 'rw' }
      ]
    }
    expect(effectiveRoots(settings)).toEqual([{ path: fs.realpathSync.native(good), access: 'rw' }])
  })

  it('persistedRoots pins valid roots to the real target but keeps invalid roots as the raw selection', () => {
    const good = dir('keep')
    const ghost = path.join(home, 'missing')
    const settings = {
      roots: [
        { path: good, access: 'rw' },
        { path: ghost, access: 'ro' }
      ]
    }
    // Valid → canonical target; invalid → original selection (never dropped), so the
    // owner can still see and fix it. Neither is re-normalized a second time.
    expect(persistedRoots(settings)).toEqual([
      { path: fs.realpathSync.native(good), access: 'rw' },
      { path: ghost, access: 'ro' }
    ])
  })

  it('classifyRoot always carries the original selection alongside the canonical path', () => {
    const good = dir('sel')
    expect(classifyRoot({ path: good, access: 'ro' })).toMatchObject({ selected: good, path: fs.realpathSync.native(good) })
  })

  it('mountsFor builds host:container[:ro] specs from resolved roots', () => {
    const specs = mountsFor([
      { path: 'C:/read', access: 'ro' },
      { path: 'C:/write', access: 'rw' }
    ])
    expect(specs.map(m => m.spec)).toEqual(['C:/read:/mnt/root0:ro', 'C:/write:/mnt/root1'])
  })
})

describe('denyAllSafeRoot', () => {
  it('is a deterministic path parented by the partner-settings.json file', () => {
    expect(denyAllSafeRoot()).toBe(path.join(home, 'business', 'partner-settings.json', '.deny-all'))
    expect(denyAllSafeRoot()).toBe(denyAllSafeRoot())
    // Its parent is the settings file path — the sentinel lives one level under it.
    expect(path.dirname(denyAllSafeRoot())).toBe(path.join(home, 'business', 'partner-settings.json'))
  })

  it('cannot be created by file operations while the settings file exists (parent is a regular file)', () => {
    const settingsFile = path.join(home, 'business', 'partner-settings.json')
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true })
    fs.writeFileSync(settingsFile, '{}')
    // The parent of the sentinel is an existing regular file, not a directory.
    expect(fs.statSync(path.dirname(denyAllSafeRoot())).isFile()).toBe(true)
    // Every write-tool primitive under it fails at the OS layer (ENOTDIR): a
    // descendant of a regular file cannot be created — this is the deny-all.
    expect(() => fs.writeFileSync(denyAllSafeRoot(), 'x')).toThrow()
    expect(() => fs.mkdirSync(denyAllSafeRoot(), { recursive: true })).toThrow()
    expect(() => fs.mkdirSync(path.join(denyAllSafeRoot(), 'nested'), { recursive: true })).toThrow()
    // And the guarding parent file cannot be turned into a directory in place.
    expect(() => fs.mkdirSync(settingsFile)).toThrow()
  })
})
