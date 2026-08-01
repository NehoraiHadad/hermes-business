import { describe, expect, it } from 'vitest'
import { cronJobId, cronJobMatches } from './cron-identity.cjs'
import { CRON_JOB_ID_CASES } from '../shared/cron-identity-contract.js'

// Regression guard for the shared-state cron-identity boundary. The SAME Hermes
// scheduler job is emitted with DIFFERENT identity keys per door:
//   - REST /api/cron/jobs + on-disk cron/jobs.json -> `id`
//   - RPC cron.manage / cronjob tool (_format_job) -> `job_id` (== that id)
//   - all doors also carry a human `name`
// The check-in reconcile probe used to read `id` off the REST shape and then look
// for it via `(j.id || j.name)` in the RPC list — which has only `job_id` — so it
// fell through to `name` and never matched. These tests pin both shapes as
// first-class and lock the cross-door match.

const REST_ID = 'a1b2c3d4e5f6'

describe('cronJobId', () => {
  // The shared contract is the single source of truth both this CJS copy and the
  // bundled plugin copy (src/lib/plugin-cron-identity.test.ts) must satisfy.
  it.each(CRON_JOB_ID_CASES)('$label', ({ job, id }) => {
    expect(cronJobId(job)).toBe(id)
  })

  it('returns null for undefined too (not in the JSON-shaped contract table)', () => {
    expect(cronJobId(undefined)).toBeNull()
  })
})

describe('cronJobMatches', () => {
  it('matches an RPC row (job_id only) by the id read off the REST shape — the exact regression', () => {
    const rpcRow = { job_id: REST_ID, name: 'nightly brief' }
    expect(cronJobMatches(rpcRow, REST_ID)).toBe(true)
  })

  it('matches a REST/disk row (id only) by the same id', () => {
    expect(cronJobMatches({ id: REST_ID, name: 'nightly brief' }, REST_ID)).toBe(true)
  })

  it('matches a name-only row by its name (name-derived canonical id, no stable id)', () => {
    expect(cronJobMatches({ name: 'nightly brief' }, 'nightly brief')).toBe(true)
  })

  it('does NOT match a job that has a stable id by its human name (stable-id precedence)', () => {
    // A job carrying a real id is addressed by that id across doors; matching it by
    // name would let a name collision hijack the wrong row.
    expect(cronJobMatches({ id: REST_ID, name: 'nightly brief' }, 'nightly brief')).toBe(false)
  })

  it('does NOT let a different job whose name equals the searched id masquerade as it', () => {
    // The collision the precedence rule exists to stop: another job happens to be
    // NAMED after this job's canonical id but owns a different stable id.
    const collider = { id: 'zzz000111222', name: REST_ID }
    expect(cronJobMatches(collider, REST_ID)).toBe(false)
    // Same guard when the colliding row only exposes the RPC job_id alias.
    expect(cronJobMatches({ job_id: 'zzz000111222', name: REST_ID }, REST_ID)).toBe(false)
  })

  it('does not match an unrelated ref or an empty/missing ref', () => {
    expect(cronJobMatches({ job_id: REST_ID, name: 'nightly brief' }, 'other')).toBe(false)
    expect(cronJobMatches({ id: REST_ID }, '')).toBe(false)
    expect(cronJobMatches({ id: REST_ID }, null)).toBe(false)
    expect(cronJobMatches(null, REST_ID)).toBe(false)
  })

  it('recognizes the same job across all three doors from one id', () => {
    const id = REST_ID
    const restRow = { id, name: 'brief', enabled: true }
    const rpcRow = { job_id: id, name: 'brief', enabled: true }
    const diskRow = { id, name: 'brief', enabled: false }
    for (const row of [restRow, rpcRow, diskRow]) {
      expect(cronJobMatches(row, id)).toBe(true)
    }
  })
})
