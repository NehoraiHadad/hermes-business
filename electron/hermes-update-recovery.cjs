const { findHermes } = require('./paths.cjs')
const { rememberLog } = require('./logs.cjs')
const {
  assertFullHealth,
  assertGatewayDeepHealthy,
  waitForGatewayDeepHealth,
  GATEWAY_SETTLE_POLL_MS
} = require('./hermes-health.cjs')
const { rollbackAfterFailedUpdate } = require('./hermes-rollback.cjs')
const {
  detectIncompleteUpdate,
  recordFailure,
  clearJournal
} = require('./hermes-update-journal.cjs')

// Launch-time recovery for an update that was interrupted (crash, power loss, or
// a failure the flow could not finish handling). Runs on app readiness. It is
// deterministic and idempotent — a still-present journal is the single trigger.
//
// Order of remediation:
//   1. Detect an incomplete journal. None → nothing to do.
//   2. Assert BOTH foreground serve health AND background gateway deep health as
//      the install currently sits. If both pass, the update effectively landed
//      (it just never got to clear the journal) → archive + clear as recovered.
//   3. Otherwise, roll back to the captured git anchor (non-git → fail closed to
//      the verified backup) and re-assert BOTH healths. Only if the rollback
//      restored the checkout AND both healths pass do we clear the journal.
//   4. If we still cannot reach a verified-healthy state, we LEAVE the journal in
//      place (so the next launch retries), record the failures, and surface an
//      honest, non-secret message for the UI. We never report restored/running
//      unless both checks actually pass.
//
// ── Why step 2 waits before it samples ───────────────────────────────────────
// Step 2 is not merely a report: FAILING it is what authorises step 3 to `git
// reset` the install checkout. So a health check that samples too early does not
// produce a false alarm here — it DESTROYS a landed update and then tells the
// owner it rolled back, which the owner cannot tell apart from a genuine failure.
//
// And this path is MORE exposed to that race than any other. main.cjs runs it
// immediately after `await ensureGatewayBackground()` + `await startHermes()`,
// before the guard recovery, the guard-activation transaction and the companion
// recovery — all of which happen to buy the gateway time that this call site does
// not get. ensureGatewayBackground returns when the gateway PROCESS is up; the
// gateway then needs ~15-16 s more to reach gateway_state.json state='running'
// (deep probe [5]), almost all of it spent connecting platforms. Measured live
// twice on 2026-08-18 — see the note on waitForGatewayDeepHealth in
// hermes-health.cjs for the raw timeline.
//
// So step 2 first WAITS, bounded, on the read-only deep probe, and only then runs
// the unchanged assertFullHealth exactly once. The wait is ADVISORY: it decides
// nothing. Whether it succeeds or times out, the same single assertion produces
// the verdict, so a genuinely broken install still takes the rollback path with
// the same anchor, the same journal handling and the same user-facing copy.
//
// The BUDGET here is 180 s, deliberately larger than the companion updater's
// 120 s, for two reasons that are specific to this call site:
//   * it samples EARLIER in the launch sequence (see above), so less of the
//     gateway's settle has already elapsed when it looks;
//   * the cost matrix is asymmetric and one side is irreversible. Waiting too
//     long costs launch-path seconds on a path that only runs at all when a
//     previous update was interrupted; sampling too early spends a destructive
//     `git reset` on a healthy install. The budget goes to the side that cannot
//     be undone.
// 180 s is not invented for this: it is exactly the budget gateway-ensure.cjs
// already grants `gateway install --start-now`, i.e. this repo's existing
// statement of how long a gateway may take to come up. The poll interval stays
// the shared GATEWAY_SETTLE_POLL_MS (~5 s against a probe that itself costs
// ~5.7 s), so the worst case is ~16 probes.
//
// Step 3's POST-ROLLBACK assertion deliberately does NOT wait, and that is not an
// oversight: (a) rollbackAfterFailedUpdate only `git reset`s the checkout — it
// never stops or restarts the gateway, so there is no new settle window to wait
// for; and (b) reaching step 3 at all means the full deadline above was already
// burned, so the gateway has had at least that long regardless.
const ROLLBACK_SETTLE_DEADLINE_MS = 180_000

async function recoverIncompleteUpdate(deps = {}) {
  const {
    detect = detectIncompleteUpdate,
    resolveCommand = findHermes,
    fullHealth = assertFullHealth,
    rollback = rollbackAfterFailedUpdate,
    fail = recordFailure,
    clear = clearJournal,
    // The bounded settle wait and everything it needs, injectable down to the
    // clock and the sleep so the ordering AND the bounds are testable without a
    // test ever actually waiting.
    awaitGatewayHealth = waitForGatewayDeepHealth,
    assertGatewayDeep = assertGatewayDeepHealthy,
    // No default: an uninjected `sleep` stays undefined and the shared helper
    // falls back to its own real setTimeout.
    sleep,
    now = Date.now,
    settleDeadlineMs = ROLLBACK_SETTLE_DEADLINE_MS,
    settlePollMs = GATEWAY_SETTLE_POLL_MS,
    log = rememberLog
  } = deps

  const record = detect()
  if (!record) return { recovered: false, action: 'none' }
  log(`Detected incomplete Hermes update (phase=${record.phase}); attempting deterministic recovery`)

  const command = resolveCommand()
  if (!command) {
    fail(new Error('Hermes binary not found during update recovery'))
    return { recovered: false, action: 'no-command', message: 'Hermes אינו מותקן; לא ניתן להשלים שחזור עדכון.' }
  }

  // 2. Is the install already verified-healthy as it sits?
  // Bounded, non-mutating wait FIRST (see the header): the gateway may still be
  // coming up, and mistaking that for a broken update is what would authorise the
  // destructive rollback below. The result is advisory only — the assertion after
  // it is unchanged and still decides alone.
  const settle = await awaitGatewayHealth(command, {
    assertGatewayDeep,
    sleep,
    now,
    deadlineMs: settleDeadlineMs,
    pollMs: settlePollMs,
    log
  })
  if (!settle.healthy) {
    log(
      `Gateway still not deep-healthy ${settle.waitedMs}ms into update recovery; running the health gate anyway (its verdict decides whether to roll back)`
    )
  }
  try {
    await fullHealth(command)
    clear({ outcome: 'recovered-healthy' })
    log('Incomplete update recovered: install is healthy; journal cleared')
    return { recovered: true, action: 'already-healthy', record }
  } catch (healthError) {
    fail(healthError)
    log(`Post-crash health failed (${healthError.message || healthError}); attempting rollback`)
  }

  // 3. Roll back to the pre-update anchor and re-assert both healths.
  const outcome = rollback({ command, anchor: record.anchor, backupPath: record.backupPath })
  if (outcome.restored) {
    try {
      await fullHealth(command)
      clear({ outcome: 'recovered-rolledback' })
      log(`Incomplete update rolled back to ${String(outcome.commit).slice(0, 10)} and verified healthy; journal cleared`)
      return { recovered: true, action: 'rolled-back', commit: outcome.commit, record }
    } catch (afterRollbackError) {
      fail(afterRollbackError)
      log(`Rollback restored the checkout but health still failed: ${afterRollbackError.message || afterRollbackError}`)
      return {
        recovered: false,
        action: 'rolled-back-unhealthy',
        message: 'שחזור העדכון הוחזר לגרסה הקודמת אך בדיקות הבריאות עדיין נכשלות; פנה לתמיכה.',
        record
      }
    }
  }

  // 4. Could not restore automatically — leave the journal for the next launch
  // and surface the honest fail-closed message (points at the verified backup).
  log('Incomplete update could not be recovered automatically; journal preserved for retry')
  return { recovered: false, action: 'fail-closed', message: outcome.message, record }
}

module.exports = { recoverIncompleteUpdate, ROLLBACK_SETTLE_DEADLINE_MS }
