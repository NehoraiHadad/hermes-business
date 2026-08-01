// Pure post-processing over the records produced by snapshotTree(): fold them into
// one fingerprint, count unsafe / top-level entries, and diff two snapshots into
// STRUCTURAL vs CONTENT drift. Every output is a count or a single sha256 — snapshot
// content bytes are never retained or exposed. The fail-closed WALKER that produces
// these records lives in isolated-marker-snapshot.mjs, which re-exports this surface.
import { createHash } from 'node:crypto'

/** Fold a snapshot into one sha256 fingerprint; content bytes are never exposed. */
export function fingerprintTree(entries) {
  const h = createHash('sha256')
  for (const e of entries) h.update(`${e.rel}\0${e.type}\0${e.hash}\n`)
  return h.digest('hex')
}

/** Count `unsafe` records in a snapshot (fail-closed disclosure signal). */
export function countUnsafe(entries) {
  return entries.reduce((n, e) => n + (e.type === 'unsafe' ? 1 : 0), 0)
}

/** Count top-level entries (rel with no separator) — preserves inventory counts. */
export function countTopLevel(entries) {
  return entries.reduce((n, e) => n + (e.rel.includes('/') || e.rel === '.' ? 0 : 1), 0)
}

/**
 * Separate STRUCTURAL (path add/remove/type-change) from CONTENT (same-path,
 * same-type file with a different byte hash) drift between two snapshots. Returns
 * COUNTS only — no relative paths — so nothing leaks to tracked evidence.
 */
export function diffSnapshots(before, after) {
  const b = new Map(before.map(e => [e.rel, e]))
  const a = new Map(after.map(e => [e.rel, e]))
  let structural = 0
  let content = 0
  for (const [rel, ea] of a) {
    const eb = b.get(rel)
    if (!eb) structural++
    else if (eb.type !== ea.type) structural++
    else if (ea.type === 'file' && eb.hash !== ea.hash) content++
  }
  for (const rel of b.keys()) if (!a.has(rel)) structural++
  return { structural, content }
}
