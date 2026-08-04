// Live/temp HERMES_HOME profile marker + forensic diff for the isolated packaged
// E2E. It only OBSERVES a home dir. STABLE layer: config.yaml bytes, the cron JOB
// DEFINITIONS (see isolated-marker-cron.mjs), and a deterministic RECURSIVE content
// fingerprint (rel-path+type+BYTES) of every durable/app-managed tree — a nested
// edit or same-size rewrite flips it → fail closed; only bytecode caches (every
// tree) and skills-scoped Curator metadata are excluded, by explicit policy (see
// isolated-marker-snapshot-policy.mjs). VOLATILE layer: `sessions` and `cron`
// directory name/size churn, disclosed as counts, never a mutation. DBs, memories/,
// logs, caches, platform dirs: not recursed (see docs).
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { countTopLevel, countUnsafe, diffSnapshots, fingerprintTree, snapshotTree } from './isolated-marker-snapshot.mjs'
import { snapshotPolicyFor } from './isolated-marker-snapshot-policy.mjs'
import { cronJobsChanged, cronJobsUnreadable, readCronJobs } from './isolated-marker-cron.mjs'
import { nameAddRemove, scanVolatile, sizeChangedCount } from './isolated-marker-volatile.mjs'
const VOLATILE_DIRS = ['sessions', 'cron']
// Durable authored + app-managed trees, fully recursive (bytes only, no content
// exposed). desktop-plugins/business are companion-managed but PROTECTED — the
// exact state isolation must not disturb. agents/workflows absent in 0.19.1.
const STABLE_TREE_DIRS = ['skills', 'plugins', 'desktop-plugins', 'business', 'agents', 'workflows', 'hooks']

// Profile marker. `digest` covers ONLY protected state (excludes session/cron
// churn). Raw snapshots/name/size maps are retained so markerDelta can attribute
// every change precisely without leaking content/paths.
export function hermesHomeMarker(home) {
  const configPath = path.join(home, 'config.yaml')
  const configPresent = existsSync(configPath)
  const configBytes = configPresent ? readFileSync(configPath) : Buffer.from('<absent>')
  const configHash = createHash('sha256').update(configBytes).digest('hex')
  const dirNames = {}
  const dirSizes = {}
  for (const dir of VOLATILE_DIRS) {
    const { names, sizes } = scanVolatile(path.join(home, dir))
    dirNames[dir] = names
    dirSizes[dir] = sizes
  }
  const treeSnapshots = {}
  const treeUnsafe = {}
  const inventory = {}
  const cronJobs = readCronJobs(home)
  const stable = createHash('sha256')
  stable.update('config.yaml\0')
  stable.update(configBytes)
  stable.update(`\0cron-jobs:${cronJobs.present}\0`)
  stable.update(cronJobs.digest)
  for (const dir of STABLE_TREE_DIRS) {
    // Explicit per-tree policy: Curator/learning metadata is churn ONLY in skills.
    const snap = snapshotTree(path.join(home, dir), snapshotPolicyFor(dir))
    treeSnapshots[dir] = snap
    treeUnsafe[dir] = countUnsafe(snap)
    inventory[dir] = countTopLevel(snap)
    stable.update(`\0tree:${dir}\0`)
    stable.update(fingerprintTree(snap))
  }
  for (const dir of VOLATILE_DIRS) inventory[dir] = dirNames[dir].length
  inventory.cron_jobs = cronJobs.count
  return {
    digest: stable.digest('hex'),
    configPresent,
    cronJobs,
    _configHash: configHash,
    _dirNames: dirNames,
    _dirSizes: dirSizes,
    _treeSnapshots: treeSnapshots,
    treeUnsafe,
    inventory
  }
}
/**
 * Diff two markers — COUNTS only, never names/paths. `profile_defining_unchanged`
 * is STRICTER than `digest_equal`: it also requires zero unsafe entries and a
 * READABLE cron job set on both sides, so an unchanged symlink/reparse/unreadable
 * record or a jobs.json we could not parse (identical fingerprint, thus
 * digest_equal) still fails closed. Otherwise: config byte-identical, the cron job
 * definitions identical, no tree drift. Structural (path add/remove/type-change) vs
 * content (same-path byte rewrite — the size-evading hole this closes) SEPARATE.
 */
export function markerDelta(before, after) {
  const addedRemoved = {}
  for (const dir of VOLATILE_DIRS) {
    const ar = nameAddRemove(before, after, dir)
    if (ar) addedRemoved[dir] = ar
  }
  const configChanged =
    before.configPresent !== after.configPresent || before._configHash !== after._configHash
  const stableStructural = {}
  const stableContent = {}
  let stableUnsafe = 0
  for (const dir of STABLE_TREE_DIRS) {
    const d = diffSnapshots(before._treeSnapshots?.[dir] ?? [], after._treeSnapshots?.[dir] ?? [])
    if (d.structural) stableStructural[dir] = d.structural
    if (d.content) stableContent[dir] = d.content
    // Fail closed on ANY unsafe record in EITHER snapshot: a pre-existing
    // symlink/reparse/unreadable/bounds entry stays byte-identical yet must never pass.
    stableUnsafe += (before.treeUnsafe?.[dir] ?? 0) + (after.treeUnsafe?.[dir] ?? 0)
  }
  const jobsChanged = cronJobsChanged(before.cronJobs, after.cronJobs)
  const jobsUnreadable = cronJobsUnreadable(before.cronJobs, after.cronJobs)
  const profileDefiningUnchanged =
    !configChanged &&
    !jobsChanged &&
    !jobsUnreadable &&
    stableUnsafe === 0 &&
    Object.keys(stableStructural).length === 0 &&
    Object.keys(stableContent).length === 0
  const sessionsVolatile =
    (addedRemoved.sessions ? addedRemoved.sessions.added + addedRemoved.sessions.removed : 0) +
    sizeChangedCount(before, after, 'sessions')
  // The ticker's own files (.tick.lock, ticker_heartbeat, catch_up_occurrences,
  // executions.db, atomically-replaced jobs.json) appear, vanish and resize while
  // the operator's gateway runs. Disclosed as churn — the JOBS are what's protected.
  const cronVolatile =
    (addedRemoved.cron ? addedRemoved.cron.added + addedRemoved.cron.removed : 0) +
    sizeChangedCount(before, after, 'cron')
  const volatileRuntimeChanges = {}
  if (sessionsVolatile) volatileRuntimeChanges.sessions = sessionsVolatile
  if (cronVolatile) volatileRuntimeChanges.cron = cronVolatile
  return {
    digest_equal: before.digest === after.digest,
    config_changed: configChanged,
    added_removed: addedRemoved,
    cron_jobs_changed: jobsChanged,
    cron_jobs_unreadable: jobsUnreadable,
    cron_jobs_before: before.cronJobs?.count ?? null,
    cron_jobs_after: after.cronJobs?.count ?? null,
    stable_structural_changed: stableStructural,
    stable_content_changed: stableContent,
    stable_unsafe_entries: stableUnsafe,
    profile_defining_unchanged: profileDefiningUnchanged,
    volatile_runtime_changes: volatileRuntimeChanges
  }
}
