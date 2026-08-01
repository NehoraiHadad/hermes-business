// Seed a PAUSED scheduled task directly into an isolated Hermes cron store so the
// real-loader E2E can prove — positively — that the companion backend's paused-
// inclusive door is what surfaces it. This is airtight: the active-only fallback
// (cron.manage -> list_jobs(include_disabled=False)) filters paused jobs OUT, so a
// paused row can only render if list_jobs(include_disabled=True) was reached.
//
// Store contract (installed hermes-agent/cron/jobs.py): the default profile reads
// <HERMES_HOME>/cron/jobs.json shaped {"jobs": [...]}. A record with
// enabled:false normalizes to state:"paused" (jobs.py::_normalize_job_record), and
// the read-only backend projects only the safe fields (id/name/enabled/schedule/
// schedule_display/state/next_run_at) — no prompt/recipient ever leaves the store.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const SEED_JOB_ID = 'realloader-paused-seed'
export const SEED_JOB_NAME = 'בדיקת משימה מושהית'

/** Write one paused job into <home>/cron/jobs.json. Returns { id, name, file }. */
export function seedPausedCronJob(home, { id = SEED_JOB_ID, name = SEED_JOB_NAME } = {}) {
  const cronDir = path.join(home, 'cron')
  mkdirSync(cronDir, { recursive: true })
  const job = {
    id,
    name,
    // The read-only door refuses to emit prompt/deliver; keep them empty anyway so
    // nothing business-shaped is even present in the isolated store.
    prompt: '',
    schedule: { display: 'כל יום בשעה 09:00', expr: '0 9 * * *' },
    schedule_display: 'כל יום בשעה 09:00',
    enabled: false, // -> normalizes to state:"paused"; filtered out of the active-only door
    state: 'paused',
    paused_at: null,
    paused_reason: null,
    next_run_at: null,
    created_at: null,
    deliver: null
  }
  const file = path.join(cronDir, 'jobs.json')
  writeFileSync(file, `${JSON.stringify({ jobs: [job], updated_at: '' }, null, 2)}\n`)
  return { id, name, file }
}
