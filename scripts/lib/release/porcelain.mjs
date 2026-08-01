// Pure `git status --porcelain -z` parser + registry-driven dirty membership.
//
// The prior dirty-inputs gate parsed the DEFAULT porcelain output with a regex
// (`l.slice(3)`, strip quotes, `.split(' -> ').pop()`) and decided membership with
// a hand-maintained path regex. Both are fragile:
//   * default porcelain C-quotes any path with spaces / non-ASCII / control bytes,
//     so a Hebrew or spaced filename (this project ships one!) is mis-sliced.
//   * a rename record `R  old -> new` needs BOTH sides considered.
//   * a membership regex drifts from the real subject registry it should mirror.
// This module parses the unambiguous NUL-delimited `-z` stream (no quoting, ever)
// and decides membership against the SAME declarative selectors the fingerprint
// uses (subject-registry.mjs RELEASE_DIRTY_INPUTS).

import { RELEASE_DIRTY_INPUTS } from '../subject-registry.mjs'

/**
 * Parse a `git status --porcelain=v1 -z` buffer/string into records. In -z mode
 * records are NUL-terminated and NEVER quoted; a rename/copy (X or Y is R/C) is
 * followed by a SECOND NUL-delimited token carrying the origin path. Returns
 * [{ x, y, path, orig }] where `orig` is the rename source or null.
 */
export function parsePorcelainZ(input) {
  const s = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '')
  const toks = s.split('\0')
  const out = []
  for (let i = 0; i < toks.length; i++) {
    const rec = toks[i]
    if (!rec) continue
    if (rec.length < 4) continue // "XY p" minimum
    const x = rec[0]
    const y = rec[1]
    const pathStr = rec.slice(3) // skip "XY "
    let orig = null
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      orig = toks[++i] ?? null // the very next NUL token is the source path
    }
    out.push({ x, y, path: pathStr, orig })
  }
  return out
}

/** Every path a set of records touches (rename → both new and old sides). */
export function affectedPaths(records) {
  const set = new Set()
  for (const r of records) {
    if (r.path) set.add(normalize(r.path))
    if (r.orig) set.add(normalize(r.orig))
  }
  return [...set]
}

function normalize(p) {
  return String(p).replace(/\\/g, '/').replace(/^"|"$/g, '')
}

/** Does a repo-relative POSIX path match one registry selector? Mirrors the
 * resolver's semantics: `{file}` exact, `{dir,exclude?,exts?}` prefix + filters. */
export function matchesSelector(posix, sel) {
  if (sel.file) return posix === sel.file
  if (sel.dir) {
    if (posix !== sel.dir && !posix.startsWith(sel.dir + '/')) return false
    if (sel.exclude && sel.exclude.test(posix)) return false
    if (sel.exts) {
      const dot = posix.lastIndexOf('.')
      const ext = dot >= 0 ? posix.slice(dot).toLowerCase() : ''
      if (!sel.exts.includes(ext)) return false
    }
    return true
  }
  return false
}

/** True iff a path is a release-blocking runtime/build/config input per registry. */
export function isReleaseDirtyInput(posix, selectors = RELEASE_DIRTY_INPUTS) {
  return selectors.some(sel => matchesSelector(posix, sel))
}

/**
 * The sorted, de-duplicated set of uncommitted RELEASE-BLOCKING inputs from a
 * porcelain-z stream. Runs the -z parse, expands renames to both sides, and keeps
 * only paths that match the release-dirty registry — nothing else (docs, evidence,
 * tests, generated outputs) can trip the gate.
 */
export function dirtyReleaseInputs(porcelainZ, selectors = RELEASE_DIRTY_INPUTS) {
  const touched = affectedPaths(parsePorcelainZ(porcelainZ))
  return [...new Set(touched.filter(p => isReleaseDirtyInput(p, selectors)))].sort()
}
