// The live profile's CRON JOB SET — the thing an isolated run must never touch.
//
// Hermes 0.19.1 keeps every job in a single `cron/jobs.json`, so the cron
// DIRECTORY's name-set says nothing about which jobs exist: the ticker's own
// runtime files (.tick.lock, ticker_heartbeat, catch_up_occurrences, ...) come
// and go while jobs.json is atomically replaced in place. Protecting the
// name-set therefore failed on the operator's own gateway ticking during a run,
// while a genuinely injected job — visible only as a few bytes of jobs.json —
// slipped through as "volatile size churn". This module protects the job
// definitions themselves instead, and the directory goes back to being volatile.
//
// Nothing here is ever disclosed: callers get a digest and a count.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// Fields the live gateway rewrites by itself on every tick or run. They say
// nothing about which jobs exist or what they do, so folding them in would make
// any concurrently-running gateway look like a mutation. Every OTHER field —
// including one we have never seen — counts as definition and fails closed,
// which is the right default for a leak tripwire.
const EXECUTION_BOOKKEEPING = new Set([
  'last_run_at', 'next_run_at', 'last_status', 'last_error', 'last_delivery_error',
  'state', 'fire_claim', 'paused_at', 'paused_reason',
  // Refreshed from the active provider each run; not part of what the job IS.
  'provider_snapshot', 'model_snapshot'
])
// `repeat` carries {times, completed}: `times` is the definition, `completed` is
// a counter the runner bumps.
const NESTED_BOOKKEEPING = { repeat: new Set(['completed']) }

const EMPTY_DIGEST = createHash('sha256').update('<no-cron-jobs>').digest('hex')

// Key-order-independent serialization, so an unrelated rewrite of the same
// definitions is not mistaken for a change.
function stable(value, drop = null) {
  if (Array.isArray(value)) return `[${value.map(v => stable(v)).join(',')}]`
  if (value && typeof value === 'object') {
    const parts = []
    for (const key of Object.keys(value).sort()) {
      if (drop?.has(key)) continue
      parts.push(`${JSON.stringify(key)}:${stable(value[key], NESTED_BOOKKEEPING[key] ?? null)}`)
    }
    return `{${parts.join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

function jobList(raw) {
  if (Array.isArray(raw)) return raw
  if (Array.isArray(raw?.jobs)) return raw.jobs
  if (raw?.jobs && typeof raw.jobs === 'object') return Object.values(raw.jobs)
  return null
}

/**
 * Fingerprint the live profile's job definitions. `parsed:false` means the file
 * exists but could not be read as a job list — an unreadable job set must fail
 * closed rather than pass as "nothing changed".
 */
export function readCronJobs(home) {
  const file = path.join(home, 'cron', 'jobs.json')
  if (!existsSync(file)) return { present: false, parsed: true, count: 0, digest: EMPTY_DIGEST }
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { present: true, parsed: false, count: null, digest: 'unparseable' }
  }
  const list = jobList(raw)
  if (!list) return { present: true, parsed: false, count: null, digest: 'unparseable' }
  const hash = createHash('sha256')
  for (const entry of list.map(job => stable(job, EXECUTION_BOOKKEEPING)).sort()) {
    hash.update(entry)
    hash.update('\0')
  }
  return { present: true, parsed: true, count: list.length, digest: hash.digest('hex') }
}

/** True when the job set moved, appeared, or vanished between two reads. */
export function cronJobsChanged(before, after) {
  return before.present !== after.present || before.digest !== after.digest
}

/** True when either side's job set could not be read — never pass on a blind spot. */
export function cronJobsUnreadable(before, after) {
  return (before.present && !before.parsed) || (after.present && !after.parsed)
}
