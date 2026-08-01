// Deterministic recursive content fingerprint for the STABLE protected profile
// trees (skills/plugins/agents/workflows). It hashes each entry's RELATIVE path,
// node type and — for files — the raw BYTES, so a nested SKILL.md edit or a
// same-size in-place byte rewrite both flip the fingerprint. Content is only ever
// folded into a sha256; it is never retained or exposed.
//
// FAIL-CLOSED, never traverse outside the home: symlinks/reparse points,
// junctions that resolve outside the tree root, unreadable entries and unknown
// node types are recorded as `unsafe` markers (with a reason tag, no bytes) and
// are NOT descended into — they deliberately flip any digest built from the walk.
// The tree ROOT is classified the same way (see snapshotTree): an absent optional
// root is safe-empty, but an existing root that is a symlink/reparse/non-directory/
// unreadable/unresolvable yields one unsafe root record and NO traversal.
//
// BOUNDED: only the single tree root passed in is walked, with depth/entry caps as
// a runaway backstop enforced BOTH on recursive descent and INSIDE a wide directory.
// The ONLY entries skipped are derived noise, governed by an EXPLICIT per-tree policy
// (isolated-marker-snapshot-policy.mjs): Python bytecode everywhere, and — skills tree
// only — exact Curator/learning-graph metadata. Every OTHER entry is hashed.

import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_POLICY, excluded } from './isolated-marker-snapshot-policy.mjs'
// Pure post-processing (fingerprint/count/diff) lives in the query module; re-exported
// here so the snapshot module stays the single public surface for consumers.
export { countTopLevel, countUnsafe, diffSnapshots, fingerprintTree } from './isolated-marker-snapshot-query.mjs'

const MAX_DEPTH = 32
const MAX_ENTRIES = 20000
// Real filesystem accessors, overridable per call for deterministic error-path
// tests (real symlink/permission failures are unreliable on Windows).
const REAL_IO = { lstatSync, readdirSync, readFileSync, realpath: realpathSync.native }
const under = (child, rootPrefix) => child.toLowerCase().startsWith(rootPrefix.toLowerCase())
const unsafeRoot = reason => [{ rel: '.', type: 'unsafe', hash: reason }]

/**
 * Walk `root` deterministically into a sorted array of records:
 *   { rel, type, hash } — type ∈ file|dir|unsafe; hash is sha256(bytes) for a
 * file, '' for a dir, or a reason tag for an unsafe entry. Relative paths use
 * forward slashes and are sorted so the fold is order-stable.
 *
 * Root classification is fail-closed and distinguishes absent from unsafe:
 *   • ENOENT/ENOTDIR                       → [] (optional tree legitimately absent)
 *   • existing root symlink / reparse      → one `symlink-root` unsafe record
 *   • existing non-directory root          → one `non-directory-root` unsafe record
 *   • unreadable root (e.g. EACCES)        → one `unreadable-root` unsafe record
 *   • unresolvable root (realpath fails)   → one `unresolvable-root` unsafe record
 * In every unsafe case NO traversal happens — a root symlink/junction is never
 * followed out of the home. `policy` is the explicit exclusion policy for this tree.
 */
export function snapshotTree(root, policy = DEFAULT_POLICY, io = REAL_IO) {
  // Classify the root itself WITHOUT following it (lstat, not stat/realpath first).
  let rootStat
  try {
    rootStat = io.lstatSync(root)
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return []
    return unsafeRoot('unreadable-root')
  }
  if (rootStat.isSymbolicLink()) return unsafeRoot('symlink-root')
  if (!rootStat.isDirectory()) return unsafeRoot('non-directory-root')
  let rootReal
  try {
    rootReal = io.realpath(root)
  } catch {
    return unsafeRoot('unresolvable-root')
  }

  const entries = []
  const rootPrefix = rootReal.replace(/[\\/]+$/, '') + path.sep
  const push = (rel, type, hash) => entries.push({ rel, type, hash })
  const walk = (abs, rel, depth) => {
    if (entries.length >= MAX_ENTRIES || depth > MAX_DEPTH) return push(rel || '.', 'unsafe', 'bounds')
    let names
    try {
      names = io.readdirSync(abs).sort()
    } catch {
      return push(rel || '.', 'unsafe', 'unreadable-dir')
    }
    for (const name of names) {
      // Enforce the entry cap INSIDE the loop too, so a single very wide directory
      // overflows to `unsafe` and stops rather than pushing unboundedly.
      if (entries.length >= MAX_ENTRIES) return push(rel || '.', 'unsafe', 'bounds')
      if (excluded(name, policy)) continue
      const childAbs = path.join(abs, name)
      const childRel = rel ? `${rel}/${name}` : name
      let st
      try {
        st = io.lstatSync(childAbs)
      } catch {
        push(childRel, 'unsafe', 'unreadable')
        continue
      }
      if (st.isSymbolicLink()) {
        push(childRel, 'unsafe', 'symlink')
      } else if (st.isDirectory()) {
        let real
        try {
          real = io.realpath(childAbs)
        } catch {
          push(childRel, 'unsafe', 'unresolvable')
          continue
        }
        if (real.toLowerCase() !== rootReal.toLowerCase() && !under(real, rootPrefix)) {
          push(childRel, 'unsafe', 'escapes-root')
          continue
        }
        push(childRel, 'dir', '')
        walk(childAbs, childRel, depth + 1)
      } else if (st.isFile()) {
        try {
          push(childRel, 'file', createHash('sha256').update(io.readFileSync(childAbs)).digest('hex'))
        } catch {
          push(childRel, 'unsafe', 'unreadable')
        }
      } else {
        push(childRel, 'unsafe', 'unknown-type')
      }
    }
  }
  walk(rootReal, '', 0)
  return entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
}
