// Reconciles the optional partner check-in against the ONE official Hermes cron
// store (via partner-cron.cjs REST). No parallel scheduler, no cache: settings hold
// only the user's INTENT (opt-in + cadence); the authoritative schedule is a real
// Hermes cron job, visible in full Hermes and the simple UI alike. Reconciliation
// is idempotent (safe on every startup + settings change) and only ever touches
// jobs carrying our stable ownership marker — user tasks are never touched.
//
// The pure definition + job-shape layer (marker, cadences, prompt, predicates and
// readers over a job) lives in partner-checkin-def.cjs; this module owns the
// stateful cron operations (reconcile, live status) and stays the single public
// entry point, re-exporting the def surface the UI/tests consume.

const {
  cronJobId,
  MARKER,
  DEF_ID,
  CADENCE,
  CHECKIN_PROMPT,
  desiredCheckin,
  isOwnedCheckin,
  ownedCadence,
  jobIsPaused,
  scheduleExpr,
  checkinDrifted,
  checkinName,
  cadenceLabelForExpr
} = require('./partner-checkin-def.cjs')

// Idempotent reconcile. Enable → ensure exactly one enabled, up-to-date owned job
// (create if missing, update-while-paused if drifted, then resume, remove extras).
// Disable → PAUSE owned jobs (preserved, reversible on re-enable) — never delete.
async function reconcileCheckins(settings, cron) {
  const desired = desiredCheckin(settings)
  const jobs = await cron.list()
  const owned = jobs.filter(isOwnedCheckin).sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
  const result = { desired: Boolean(desired), created: false, updated: false, resumed: false, paused: 0, removed: 0, jobId: null }

  if (!desired) {
    for (const job of owned) {
      if (!jobIsPaused(job)) {
        await cron.pause(cronJobId(job))
        result.paused += 1
      }
    }
    return result
  }

  if (owned.length === 0) {
    const created = await cron.create({ name: desired.name, prompt: desired.prompt, schedule: desired.schedule, deliver: desired.deliver })
    return { ...result, created: true, jobId: cronJobId(created) }
  }

  const [canonical, ...extras] = owned
  const id = cronJobId(canonical)
  result.jobId = id
  const wasActive = !jobIsPaused(canonical)
  // Transactional drift update: an ACTIVE job is PAUSED first (so it cannot fire
  // mid-edit), and we VERIFY it actually paused before touching its definition — if the
  // store does not confirm the pause we abort rather than edit a live job. The update
  // then lands while paused, and we resume ONLY if the job was originally active (or was
  // paused and the intent is to run it). A failed update leaves the job paused, never
  // resumed into an outdated active state.
  let pausedForUpdate = false
  if (checkinDrifted(canonical, desired)) {
    if (wasActive) {
      await cron.pause(id)
      result.paused += 1
      const after = (await cron.list()).find(job => cronJobId(job) === id)
      if (!after || !jobIsPaused(after)) {
        throw new Error('לא ניתן היה להשהות את משימת הצ׳ק־אין לפני עדכון; העדכון בוטל כדי לא לערוך משימה פעילה')
      }
      pausedForUpdate = true
    }
    await cron.update(id, { name: desired.name, schedule: desired.schedule, prompt: desired.prompt, deliver: desired.deliver })
    result.updated = true
  }
  // Converge to the intended ACTIVE state: resume when the job is currently paused —
  // either it was paused before (re-enable) or we paused it for the transactional edit.
  if (!wasActive || pausedForUpdate) {
    await cron.resume(id)
    result.resumed = true
  }
  // Converge our own accidental duplicates (same marker) to exactly one.
  for (const extra of extras) {
    await cron.remove(cronJobId(extra))
    result.removed += 1
  }
  return result
}

// Live, honest snapshot of the owned check-in job (if any) from the ONE official
// store. Best-effort: a runtime that is down yields null, never a claim.
async function readCheckinStatus(cron) {
  try {
    const owned = (await cron.list())
      .filter(isOwnedCheckin)
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
    if (owned.length === 0) {
      return { scheduled: false, paused: false, jobId: null, scheduleDisplay: null, liveSchedule: null, edited: false, duplicates: 0, activeDuplicates: 0, mismatch: false }
    }
    const job = owned[0]
    const cadence = ownedCadence(job)
    const liveExpr = scheduleExpr(job)
    const expectedExpr = (CADENCE[cadence] && CADENCE[cadence].expr) || null
    // Detect an edit performed in full Hermes: the live schedule no longer matches the
    // cadence encoded in our marker. We display the ACTUAL live schedule, not the marker.
    const edited = Boolean(expectedExpr) && Boolean(liveExpr) && liveExpr !== expectedExpr
    const label = cadenceLabelForExpr(liveExpr) || job.schedule_display || liveExpr || (CADENCE[cadence] && CADENCE[cadence].label) || null
    // Duplicates are AGGREGATED, not hidden behind the canonical job: more than one owned
    // ACTIVE job is a real inconsistency (two check-ins would fire) and is surfaced as a
    // mismatch so the caller can reconcile, even if the canonical alone looks fine.
    const activeDuplicates = owned.filter(entry => !jobIsPaused(entry)).length
    return {
      scheduled: !jobIsPaused(job),
      paused: jobIsPaused(job),
      jobId: cronJobId(job),
      scheduleDisplay: label,
      liveSchedule: liveExpr || null,
      edited,
      duplicates: owned.length,
      activeDuplicates,
      mismatch: activeDuplicates > 1
    }
  } catch {
    return null
  }
}

module.exports = {
  MARKER,
  DEF_ID,
  CADENCE,
  CHECKIN_PROMPT,
  desiredCheckin,
  isOwnedCheckin,
  ownedCadence,
  jobIsPaused,
  scheduleExpr,
  checkinDrifted,
  checkinName,
  reconcileCheckins,
  readCheckinStatus
}
