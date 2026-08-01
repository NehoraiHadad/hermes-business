// Source fingerprinting + repo identity for the build attestation.
//
// A release artifact is only as trustworthy as the COMPLETE set of packaged
// sources that produced it. `computeSourceFingerprint` therefore hashes the whole
// packaged-source input set declared once in subject-registry.mjs — the renderer
// sources vite compiles into `dist/`, the electron main-process runtime, the
// hermes-plugin tree, the installer bootstrap scripts, the packaged assets and
// package.json — NOT only electron/**/*.cjs, and never the generated
// `dist/`/`release/` outputs, `node_modules` or tests. Any packaged-source drift
// changes the fingerprint and so invalidates a prepared artifact.
//
// This module also owns the repo identity helpers (root, HEAD, product exe name);
// the manifest build/verify and artifact resolution live in build-attestation.mjs.
//
// Pure Node (crypto/fs/path only) so the harness, the generator and the unit
// suite all share one source of truth without dragging in Playwright.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashSubjects } from './subject-hash.mjs'
import { PACKAGED_INPUTS, SUBJECT_SCHEME } from './subject-registry.mjs'

/** Repo root, resolved from this module's location (scripts/lib/ -> repo). */
export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
}

/**
 * The packaged main-process sources whose staleness caused the incident. These
 * `electron/**` files are copied verbatim into app.asar (see package.json
 * `build.files`), so hashing the working-tree source is equivalent to hashing
 * what actually runs. Test files never run in the packaged app and are excluded
 * so a test-only edit does not needlessly invalidate a prepared artifact.
 */
export function listMainSources(root = repoRoot()) {
  const base = path.join(root, 'electron')
  const out = []
  const walk = dir => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile() && entry.name.endsWith('.cjs') && !/\.test\.cjs$/.test(entry.name)) {
        out.push(path.relative(root, full).split(path.sep).join('/'))
      }
    }
  }
  walk(base)
  return out.sort()
}

/**
 * Deterministic sha256 over the COMPLETE packaged-source input set (see
 * subject-registry.mjs `PACKAGED_INPUTS`). Stable across machines: it depends on
 * file CONTENT and POSIX-normalised relative paths only — never on mtimes,
 * absolute paths or build outputs. Fails closed if any declared packaged source
 * is missing (a broken tree can never fingerprint as a valid artifact).
 */
export function computeSourceFingerprint(root = repoRoot()) {
  const { fingerprint, fileCount } = hashSubjects(root, PACKAGED_INPUTS, { scheme: SUBJECT_SCHEME })
  return { fingerprint, fileCount }
}

/** Best-effort current source HEAD (never throws; returns 'unknown' off-git). */
export function currentHead(root = repoRoot()) {
  try {
    // Avoid spawning git in this pure module's hot path where possible: read the
    // ref file directly. Falls back to 'unknown' for detached/edge layouts.
    const gitDir = path.join(root, '.git')
    const headRef = readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim()
    const m = headRef.match(/^ref:\s*(.+)$/)
    if (!m) return /^[0-9a-f]{40}$/.test(headRef) ? headRef : 'unknown'
    const refPath = path.join(gitDir, m[1])
    if (existsSync(refPath)) return readFileSync(refPath, 'utf8').trim()
    // packed-refs fallback
    const packed = path.join(gitDir, 'packed-refs')
    if (existsSync(packed)) {
      for (const line of readFileSync(packed, 'utf8').split(/\r?\n/)) {
        const pm = line.match(/^([0-9a-f]{40})\s+(.+)$/)
        if (pm && pm[2] === m[1]) return pm[1]
      }
    }
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/** The product executable name electron-builder emits (build.productName). */
export function productExeName(root = repoRoot()) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const name = pkg.build?.productName || pkg.name
  return `${name}.exe`
}
