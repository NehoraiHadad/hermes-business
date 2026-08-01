// One DRY normalizer for cron-job identity across the official Hermes surfaces.
// The SAME scheduler job is exposed with DIFFERENT identity keys per door:
//   - REST /api/cron/jobs + on-disk cron/jobs.json  -> `id`     (canonical 12-hex)
//   - RPC cron.manage / cronjob tool (_format_job)  -> `job_id` (== that same id)
//   - every door also carries a human `name`
// The gateway's resolve_job_ref() accepts id OR name as a MUTATION key, so any of
// these works to address a job. But a CROSS-DOOR identity COMPARISON must treat
// `id` and `job_id` as the same first-class field — otherwise an id read off the
// REST/disk shape never matches its own row in an RPC list (which has no `id`,
// only `job_id`), which is exactly the shared-state check-in reconcile failure.
//
// Shared by the electron main (partner-checkins.cjs) and the Node E2E probes
// (scripts/lib/probes/hermes/*.mjs, imported via ESM/CJS named interop) so there
// is exactly one implementation for this architectural boundary.

// Canonical identity for a job, preferring the stable id, then the RPC job_id,
// then the human name. Returns null for a missing/empty job.
function cronJobId(job) {
  if (!job) return null
  return job.id || job.job_id || job.name || null
}

// True when `ref` identifies THIS job across doors, following Hermes' stable-id
// precedence (resolve_job_ref resolves a stable id before falling back to name):
// when a job carries a stable id — REST/disk `id` or its RPC alias `job_id`, which
// are the SAME field per door — ONLY that id can match it. So a DIFFERENT job whose
// human `name` happens to equal the searched canonical id can never masquerade as
// the job that owns that id. A name-only shape (no stable id, e.g. a row that only
// ever exposed a name) still matches by name, so a name-derived canonical id keeps
// finding its own row. This is a cross-door IDENTITY comparison, not a mutation
// key: to address a job for mutation, pass cronJobId(job) — Hermes' resolve_job_ref
// still accepts that id-or-name key. Callers that must look a job up by human name
// do so explicitly (e.g. `list.find(j => j.name === wanted)`), never through here.
function cronJobMatches(job, ref) {
  if (!job || ref == null || ref === '') return false
  const stableId = job.id || job.job_id
  if (stableId) return stableId === ref
  return job.name === ref
}

module.exports = { cronJobId, cronJobMatches }
