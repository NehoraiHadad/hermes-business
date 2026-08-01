// Deterministic, fail-closed hashing over a declared set of repository subject
// files. This is the shared hashing engine behind BOTH the build attestation
// (which packaged sources a release artifact attests) and the evidence subject
// fingerprint (which repository files a piece of acceptance evidence attests).
//
// The declarative selectors live in subject-registry.mjs; this module only
// resolves them to a concrete file list and folds their CONTENT into one sha256.
//
// Determinism guarantees (identical hash on Windows and POSIX):
//   * paths are repo-relative and normalised to forward slashes;
//   * the file list is sorted by UTF-16 code unit (plain .sort()), never by a
//     locale-sensitive collator, so Unicode filenames order identically anywhere;
//   * only file CONTENT bytes and normalised relative paths feed the hash —
//     never mtimes, absolute paths, inode order or build outputs.
//
// Fail-closed: a declared file that is missing/unreadable, or a declared
// directory that resolves to zero files, throws MissingSubjectError. A verifier
// turns that throw into a rejection with a recapture hint — a missing subject is
// never silently treated as "nothing changed".

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

export class MissingSubjectError extends Error {
  constructor(message) {
    super(message)
    this.name = 'MissingSubjectError'
  }
}

/** Repo-relative, forward-slash path for `abs` under `root`. */
function relPosix(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/')
}

/** Recursively collect files under `dir`, applying an optional exclude RegExp
 * (tested against the repo-relative POSIX path) and optional extension allow-set.
 * Returns repo-relative POSIX paths; missing dir yields []. */
function walkDir(root, dir, { exclude, exts } = {}) {
  const abs = path.join(root, dir)
  const out = []
  const recurse = current => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      const rel = relPosix(root, full)
      if (exclude && exclude.test(rel)) continue
      if (entry.isDirectory()) {
        recurse(full)
      } else if (entry.isFile()) {
        if (exts && !exts.includes(path.extname(entry.name).toLowerCase())) continue
        out.push(rel)
      }
    }
  }
  recurse(abs)
  return out
}

/** Resolve one selector to repo-relative POSIX paths, failing closed on a missing
 * required subject. Selector kinds: `{ file }` (single required file) and
 * `{ dir, exclude?, exts? }` (recursive; required to be non-empty). */
export function resolveSelector(root, selector) {
  if (selector.file) {
    const abs = path.join(root, selector.file)
    try {
      if (!statSync(abs).isFile()) throw new Error('not a file')
    } catch {
      throw new MissingSubjectError(`required subject file missing: ${selector.file}`)
    }
    return [relPosix(root, abs)]
  }
  if (selector.dir) {
    const files = walkDir(root, selector.dir, selector)
    if (files.length === 0) {
      throw new MissingSubjectError(`required subject directory empty or missing: ${selector.dir}`)
    }
    return files
  }
  throw new Error(`invalid subject selector: ${JSON.stringify(selector)}`)
}

/** Resolve a whole selector list to a de-duplicated, code-unit-sorted path list. */
export function resolveSubjects(root, selectors) {
  const set = new Set()
  for (const selector of selectors) for (const rel of resolveSelector(root, selector)) set.add(rel)
  return [...set].sort()
}

/**
 * Deterministic sha256 over the resolved subject set. `scheme` is a version tag
 * folded into the digest so a change to the hashing scheme itself yields a fresh
 * fingerprint namespace. Returns the hex fingerprint, the sorted files and count.
 */
export function hashSubjects(root, selectors, { scheme = 0 } = {}) {
  const files = resolveSubjects(root, selectors)
  const outer = createHash('sha256')
  outer.update(`subject-scheme\0${scheme}\n`)
  for (const rel of files) {
    const fileHash = createHash('sha256').update(readFileSync(path.join(root, rel))).digest('hex')
    outer.update(`${rel}\0${fileHash}\n`)
  }
  return { fingerprint: outer.digest('hex'), files, fileCount: files.length }
}
