// TOOL WIRING helpers — filesystem/identity/PATH seams for the release-tool
// resolver. Kept separate so tool-discovery.mjs stays a small decision module and
// so every disk touch is an injectable, unit-testable seam.
//
// electron-builder 26 lands its bundled extractor under a VERSIONED cache folder
// directly beneath the Cache root — e.g. `…/electron-builder/Cache/7zip@1.0.0/
// 7zip-win-x64-a34pt/bin/7za.exe`. The `@<ver>` folder AND the nested `bin/` mean a
// single-level readdir of a hardcoded `…/Cache/7zip` path misses it entirely (the
// original bug). `findCacheTools` enumerates the Cache root, matches every 7zip
// version folder, and walks each subtree; `whichOnPath` resolves a bare command to
// an ABSOLUTE path so we never inject a PATH-only name.

import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

/** Real-fs default: does the absolute path exist? Swallows fs errors → false. */
export function fsExists(p) {
  try { return !!p && existsSync(p) } catch { return false }
}

/** Real-fs default: sha256 of a file (null when unreadable) — matches the sync
 * hashFile the release callers already inject, so behavior is identical whether the
 * seam is supplied or defaulted. */
export function fsHashFile(p) {
  try { return createHash('sha256').update(readFileSync(p)).digest('hex') } catch { return null }
}

/** readdir returning [{name,isDirectory}]; injectable for tests. */
export function defaultReaddir(d) {
  return readdirSync(d, { withFileTypes: true }).map(e => ({ name: e.name, isDirectory: e.isDirectory() }))
}

/** Recursively collect absolute paths of files named `filename` (case-insensitive)
 * under `dir`, bounded by `maxDepth`. `readdir` is injectable so tests exercise a
 * nested `7zip@X/…/bin/7za.exe` layout without touching disk. */
export function scanToolTree({ dir, filename, readdir = defaultReaddir, maxDepth = 8 } = {}) {
  const out = []
  const target = String(filename).toLowerCase()
  const walk = (d, depth) => {
    if (depth > maxDepth) return
    let entries
    try { entries = readdir(d) } catch { return }
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory) walk(full, depth + 1)
      else if (String(e.name).toLowerCase() === target) out.push(full)
    }
  }
  walk(dir, 0)
  return out
}

/** Order two versioned paths newest-first (numeric-aware over every embedded digit
 * group), so a later cache folder is preferred over an older one. */
export function byVersionDesc(a, b) {
  const norm = p => (String(p).match(/(\d+(?:\.\d+)*)/g) || ['0']).join('.').split('.').map(Number)
  const av = norm(a), bv = norm(b)
  for (let i = 0; i < Math.max(av.length, bv.length); i += 1) {
    const d = (bv[i] || 0) - (av[i] || 0)
    if (d) return d
  }
  return String(b).localeCompare(String(a))
}

/** Find every bundled extractor under electron-builder's Cache ROOT. Enumerates the
 * root, keeps folders whose name is `7zip` or `7zip@<ver>` (case-insensitive — this
 * is the fix: the version is on the folder, not a fixed `7zip` subdir), and walks
 * each subtree for `7za.exe`/`7z.exe`. Returns de-duped ABSOLUTE paths, newest-first. */
export function findCacheTools({
  cacheRoot,
  folderMatch = n => /^7zip(@.*)?$/i.test(n),
  filenames = ['7za.exe', '7z.exe'],
  exists = fsExists,
  readdir = defaultReaddir,
  maxDepth = 8
} = {}) {
  if (!cacheRoot || !exists(cacheRoot)) return []
  let roots
  try { roots = readdir(cacheRoot).filter(e => e.isDirectory && folderMatch(e.name)) } catch { return [] }
  const hits = []
  for (const r of roots) {
    const dir = path.join(cacheRoot, r.name)
    for (const fn of filenames) hits.push(...scanToolTree({ dir, filename: fn, readdir, maxDepth }))
  }
  return [...new Set(hits)].sort(byVersionDesc)
}

/** Resolve a bare command name to an ABSOLUTE path via the PATH dirs (+ PATHEXT on
 * Windows), so a PATH tool is injected by full path, never by bare name. Returns null
 * when nothing resolves — the caller then fails closed. All seams injectable. */
export function whichOnPath(name, {
  pathEnv = process.env.PATH || '',
  pathext = process.env.PATHEXT || (process.platform === 'win32' ? '.EXE' : ''),
  sep = path.delimiter,
  exists = fsExists,
  join = path.join
} = {}) {
  const dirs = pathEnv.split(sep).filter(Boolean)
  const exts = /\.[^./\\]+$/.test(name) ? [''] : ['', ...pathext.split(';').filter(Boolean)]
  for (const d of dirs) {
    for (const ext of exts) {
      const full = join(d, name + ext)
      if (exists(full)) return full
    }
  }
  return null
}

/** True iff the file begins with the DOS `MZ` header of a Windows PE image. Reads
 * only the first two bytes; `readMagic` is injectable for tests. */
export function looksLikePe(file, readMagic = defaultReadMagic) {
  try {
    const b = readMagic(file)
    return !!b && b.length >= 2 && b[0] === 0x4d && b[1] === 0x5a
  } catch {
    return false
  }
}

function defaultReadMagic(file) {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(2)
    readSync(fd, buf, 0, 2, 0)
    return buf
  } finally {
    closeSync(fd)
  }
}
