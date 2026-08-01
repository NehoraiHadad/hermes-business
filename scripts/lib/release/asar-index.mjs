// Pure reader for an app.asar directory header + the packaged-content contract.
//
// WHY: a prior build shipped an app.asar that still carried *.test.* files and
// tool caches (see the audit). electron-builder `files` now excludes them, but an
// exclusion is only a promise until something VERIFIES the emitted archive. This
// module reads the asar's own directory (never the file bodies), reports any entry
// that must never ship, rejects any path that could escape the extraction root,
// and — crucially — treats a MISSING / CORRUPT / INCOMPLETE archive as a hard
// error so the release contract fails closed instead of silently passing.
//
// asar layout (a Chromium Pickle pair):
//   [0..3]   uint32LE  == 4   (payload length of the size-pickle)
//   [4..7]   uint32LE  total byte length of the header-pickle region
//   [8..11]  uint32LE  payload length of the header-pickle
//   [12..15] uint32LE  N = byte length of the JSON header string
//   [16..16+N)         the JSON directory (utf8)
// Only the directory is parsed here — enough to enumerate every packaged path.

import { openSync, readSync, closeSync } from 'node:fs'

// Legitimate third-party production deps ship inside app.asar at the archive ROOT
// (`node_modules/…`). ONLY that root tree is exempt from the forbidden-content and
// traversal rules — an arbitrary nested `electron/node_modules/…` subtree is NOT a
// verified production dependency and stays subject to every rule.
export const ROOT_NODE_MODULES_RE = /^node_modules\//
export const FORBIDDEN_ASAR_RE =
  /(^|\/)(__pycache__|\.pytest_cache|\.vite|\.vitest)(\/|$)|(^|\/)tests?\//i
export const FORBIDDEN_ASAR_FILE_RE =
  /(^|\/)test_[^/]*\.py$|\.test\.(cjs|mjs|js|jsx|ts|tsx|py)$|\.pyc$/i

/** Reject any packaged path that is not a safe, relative, forward-slash POSIX
 * path: a backslash, a drive-letter/UNC/leading-slash absolute, an empty or `.`/
 * `..` segment. Returns a reason string, or null when the path is safe. */
export function unsafeAsarPathReason(p) {
  if (typeof p !== 'string' || p.length === 0) return 'empty path'
  if (p.includes('\\')) return 'backslash separator'
  if (/^([A-Za-z]:|\/|\\\\)/.test(p)) return 'absolute path'
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') return `illegal segment "${seg}"`
  }
  return null
}

/** Parse the JSON directory out of a buffer holding at least the asar header.
 * Throws a specific error for every structural defect so corruption is loud. */
export function parseAsarHeader(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) throw new Error('asar buffer too short')
  if (buf.readUInt32LE(0) !== 4) throw new Error('asar bad size-pickle marker')
  const strLen = buf.readUInt32LE(12)
  if (strLen <= 0) throw new Error('asar header length is zero')
  if (16 + strLen > buf.length) throw new Error('asar header truncated')
  let header
  try {
    header = JSON.parse(buf.toString('utf8', 16, 16 + strLen))
  } catch {
    throw new Error('asar header is not valid JSON')
  }
  if (!header || typeof header !== 'object' || !header.files || typeof header.files !== 'object') {
    throw new Error('asar header has no files tree')
  }
  return header
}

/** Read just the header region of an asar file from disk (two small reads). */
export function readAsarHeaderFromFile(file) {
  const fd = openSync(file, 'r')
  try {
    const head = Buffer.alloc(16)
    if (readSync(fd, head, 0, 16, 0) !== 16) throw new Error('asar file too short')
    if (head.readUInt32LE(0) !== 4) throw new Error('asar bad size-pickle marker')
    const regionLen = head.readUInt32LE(4) // header-pickle region byte length
    if (regionLen <= 8 || regionLen > 512 * 1024 * 1024) throw new Error('asar header region out of range')
    const total = 8 + regionLen
    const buf = Buffer.alloc(total)
    if (readSync(fd, buf, 0, total, 0) !== total) throw new Error('asar header region incomplete')
    return parseAsarHeader(buf)
  } finally {
    closeSync(fd)
  }
}

/** Flatten an asar directory object into POSIX-relative file paths (files only). */
export function flattenAsarFiles(header, prefix = '') {
  const out = []
  const files = header && header.files
  if (!files) return out
  for (const [name, node] of Object.entries(files)) {
    const rel = prefix ? `${prefix}/${name}` : name
    if (node && node.files) out.push(...flattenAsarFiles(node, rel))
    else out.push(rel)
  }
  return out
}

/** Forbidden test/cache entries among packaged paths. A path under the archive
 * ROOT node_modules is exempt (verified production dep); nested node_modules is
 * NOT exempt. */
export function findForbiddenEntries(paths) {
  return paths.filter(
    p => !ROOT_NODE_MODULES_RE.test(p) && (FORBIDDEN_ASAR_RE.test(p) || FORBIDDEN_ASAR_FILE_RE.test(p))
  )
}

/** Every path that is unsafe (traversal / absolute / backslash). Root
 * node_modules does NOT exempt an unsafe path — a `node_modules/../x` still
 * escapes. Returns [{ path, reason }]. */
export function findUnsafePaths(paths) {
  const out = []
  for (const p of paths) {
    const reason = unsafeAsarPathReason(p)
    if (reason) out.push({ path: p, reason })
  }
  return out
}

/**
 * Inspect an asar file on disk. Never throws — a missing / corrupt / incomplete
 * archive is reported as `{ present:false|true, valid:false, error }` so the
 * caller can fail closed. `valid` is true ONLY for a fully-parsed archive with a
 * readable directory tree. `unsafe` lists traversal/absolute paths.
 */
export function inspectAsar(file) {
  let header
  try {
    header = readAsarHeaderFromFile(file)
  } catch (e) {
    // Distinguish "not there at all" from "there but broken" for honest reporting.
    const present = !/ENOENT|no such file|too short/i.test(e.message)
    return { present, valid: false, fileCount: 0, forbidden: [], unsafe: [], error: e.message }
  }
  const paths = flattenAsarFiles(header)
  return {
    present: true,
    valid: true,
    fileCount: paths.length,
    forbidden: findForbiddenEntries(paths),
    unsafe: findUnsafePaths(paths)
  }
}
