// Volatile HERMES_HOME dirs (sessions/, cron/) are runtime churn, never recursed:
// each is scanned as a name-set + per-entry SIZE, then diffed as disclosed COUNTS
// (adds/removes/resizes) rather than as profile mutations. isolated-marker.mjs folds
// these into the marker's `volatile_runtime_changes` — see there for the policy.
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

// Name-set + per-entry size of a volatile dir (never recursed); tolerant of absence.
export function scanVolatile(full) {
  const sizes = {}
  let names = []
  try {
    names = readdirSync(full).sort()
    for (const name of names) {
      try {
        sizes[name] = statSync(path.join(full, name)).size
      } catch {
        sizes[name] = -1
      }
    }
  } catch {
    names = []
  }
  return { names, sizes }
}

/** Same-name volatile files whose size moved (disclosed churn), as a count. */
export function sizeChangedCount(before, after, dir) {
  const b = before._dirSizes?.[dir] ?? {}
  const a = after._dirSizes?.[dir] ?? {}
  let n = 0
  for (const name of Object.keys(a)) if (name in b && a[name] !== b[name]) n++
  return n
}

/** Structural add/remove between two volatile name-sets, as counts. */
export function nameAddRemove(before, after, dir) {
  const b = new Set(before._dirNames?.[dir] ?? [])
  const a = new Set(after._dirNames?.[dir] ?? [])
  const added = [...a].filter(n => !b.has(n)).length
  const removed = [...b].filter(n => !a.has(n)).length
  return added || removed ? { added, removed } : null
}
