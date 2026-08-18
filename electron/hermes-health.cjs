const { runCaptured } = require('./process-util.cjs')
const { ensureGatewayBackground } = require('./google-setup.cjs')
const { startHermes, hermesApi } = require('./runtime.cjs')
const { rememberLog } = require('./logs.cjs')
const {
  interpretGatewayDeep,
  parseWindowsGatewayDeep,
  REQUIRED_PROBE_IDS,
  REQUIRED_PASS_IDS,
  ADVISORY_PROBE_IDS
} = require('./gateway-deep-probe.cjs')

// Post-update / recovery health assertions. Two INDEPENDENT surfaces MUST both
// pass before an update (or a rollback) is ever reported as restored/running:
//   1. Foreground `hermes serve` — the loopback runtime process is up and its
//      /api/health endpoint answers ok (checked via startHermes + hermesApi).
//   2. Background Hermes gateway — the official `gateway status --deep` PROCESS/
//      LIFECYCLE liveness probes pass. We reuse the SAME command the companion
//      already documents/drives, never a parallel health format.
//
// The structural, fail-closed parsing of that deep output lives in the pure
// gateway-deep-probe.cjs (unit-tested exhaustively without a live Hermes); this
// module RUNS the command and turns a non-healthy verdict into a thrown, honest
// UI error. Every collaborator is injectable so the assertions stay testable.

async function assertGatewayDeepHealthy(
  command,
  { run = runCaptured, log = rememberLog, platform = process.platform } = {}
) {
  let result
  try {
    const { stdout, stderr } = await run(command, ['gateway', 'status', '--deep'], 120_000)
    result = { ok: true, output: `${stdout || ''}\n${stderr || ''}` }
  } catch (error) {
    result = { ok: false, output: error.message || String(error) }
  }
  const verdict = interpretGatewayDeep(result, { platform })
  if (!verdict.healthy) {
    log(`Hermes gateway deep process-liveness check failed: ${verdict.reason}`)
    // Honest, scoped copy: this is the gateway PROCESS/lifecycle deep liveness
    // check — not a message-channel or cron probe.
    throw new Error(`בדיקת חיוּת עומק של תהליך שער Hermes נכשלה: ${verdict.reason}`)
  }
  return verdict
}

// ── The post-restart gateway SETTLE race, and the bounded wait that closes it ──
//
// MEASURED on the live profile, twice, on 2026-08-18 (companion update
// alpha.9 → alpha.10), from <hermesHome>/logs/gateway-exit-diag.log +
// logs/gateway.log + the companion update journal:
//
//   run 1  14:49:29.08  gateway process start (tag=gateway.start, pid 9692)
//          14:49:39.04  ← a launch-time health gate sampled: FAIL "[5] reported FAIL"
//          14:49:45.16  "Gateway running with 2 platform(s)" ⇒ gateway_state.json
//                       flips to state='running' (probe [5]) — 6.1 s TOO LATE.
//   run 2  14:57:54.81  gateway process start (pid 20648)
//          14:58:04.66  ← sampled, FAIL, same reason
//          14:58:09.63  gateway_state.json state='running' — 4.9 s TOO LATE.
//
// A gateway that was just restarted needs ~15-16 s to reach state='running', and
// almost all of it is spent CONNECTING PLATFORMS (Telegram alone took 10.7 s on
// attempt 1 of up to 8, including a DNS-over-HTTPS fallback discovery).
// ensureGatewayBackground() returns as soon as the PROCESS is up — long before it
// is READY — so any launch-time gate that samples right after it is racing.
//
// This helper is the shared mechanism that closes that race for BOTH launch-time
// recovery paths (the Hermes-agent update recovery and the תכל'ס companion update
// recovery). It lives HERE, next to the assertion it waits on, because:
//   * both callers already depend on this module and neither depends on the
//     other — the agent-update path must never learn about the companion-update
//     path, so hoisting it here adds no dependency edge and inverts none;
//   * this module is documented as the layer that RUNS the health commands
//     (gateway-deep-probe.cjs is the pure parser). Running the same command until
//     it stops disagreeing is that same layer's job.
// It is NOT a shared state machine: it has no phases, no journal, no anchor and
// no outcome vocabulary, and it DECIDES NOTHING — it returns an observation. Each
// caller keeps its own deadline constant, because their cost matrices differ (one
// gates a false alarm, the other gates a destructive `git reset`).
//
// Note what is deliberately NOT done: assertFullHealth below is UNCHANGED and
// still samples exactly once. Waiting is opt-in per call site, so no caller
// silently inherits new timing behaviour.
//
// Poll interval: ~5 s. One `gateway status --deep` costs ~5.7 s of Python CLI
// startup measured on this machine, so 5 s is a real poll (effective cadence
// ~11 s), not a busy loop.
const GATEWAY_SETTLE_POLL_MS = 5_000
// Default deadline ≈ 7.5x the measured 15-16 s settle. The margin is not padding:
// the settle is dominated by a NETWORK-bound platform connect that retries up to
// 8 times, so its tail is far longer than its median. It is also exactly the
// timeout assertGatewayDeepHealthy already grants this same command.
const GATEWAY_SETTLE_DEADLINE_MS = 120_000

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Bounded, non-mutating wait for the background gateway to finish coming up.
 *
 * ADVISORY BY CONSTRUCTION. It NEVER throws and NEVER decides an outcome: it
 * reports what it saw, and the caller's real gate — unchanged — still produces
 * the verdict. That is what keeps a genuinely broken gateway on exactly the same
 * fail-closed path it took before this existed; the wait only removes the race.
 *
 * The probe it polls is `assertGatewayDeepHealthy`, i.e. `gateway status --deep`:
 * read-only, spawns nothing, mutates nothing. Two properties make it the right
 * readiness signal:
 *   1. It is the SAME assertion that later decides, so we wait for exactly the
 *      thing that was failing. Plain `gateway status` would not help — in both
 *      measured runs the deep output's own high-level line already read "Gateway
 *      process running"; only probe [5] (the on-disk lifecycle state) lagged.
 *   2. A passing deep probe requires both "Gateway process running" AND a
 *      registered scheduled task / login item, which is a strict SUPERSET of the
 *      two conditions ensureGatewayBackground() checks before deciding not to
 *      restart the gateway. So once this returns healthy, a subsequent
 *      assertFullHealth cannot restart the gateway underneath us. That is also
 *      why callers must NOT simply retry assertFullHealth in a loop: its
 *      ensureGateway step would re-enter `gateway install --start-now` and
 *      restart the very gateway they are waiting on, resetting the clock every
 *      poll.
 *
 * Termination is guaranteed by TWO independent bounds, because either one alone
 * is easy to defeat by accident:
 *   1. the elapsed-time deadline, which depends on the injected clock advancing;
 *   2. a derived attempt cap, which does not depend on the clock at all.
 * A frozen or non-advancing `now` therefore still cannot hang the launch path.
 *
 * @returns {Promise<{ healthy: boolean, attempts: number, waitedMs: number, lastReason: string|null }>}
 */
async function waitForGatewayDeepHealth(command, deps = {}) {
  const {
    assertGatewayDeep = assertGatewayDeepHealthy,
    sleep = defaultSleep,
    now = Date.now,
    deadlineMs = GATEWAY_SETTLE_DEADLINE_MS,
    pollMs = GATEWAY_SETTLE_POLL_MS,
    log = rememberLog
  } = deps

  const pollInterval = Math.max(1, pollMs)
  const maxAttempts = Math.max(1, Math.ceil(deadlineMs / pollInterval) + 1)
  const started = now()
  let attempts = 0
  let lastReason = null

  for (;;) {
    attempts += 1
    try {
      await assertGatewayDeep(command)
      if (attempts > 1) {
        log(`Gateway reported deep-healthy after ${attempts} probe(s) over ${now() - started}ms`)
      }
      return { healthy: true, attempts, waitedMs: now() - started, lastReason: null }
    } catch (error) {
      lastReason = error && error.message ? error.message : String(error)
    }
    if (attempts >= maxAttempts) break
    if (now() - started >= deadlineMs) break
    await sleep(pollInterval)
  }

  // Honest, non-deciding log: the caller still runs the real gate, which is what
  // turns this into a user-visible verdict.
  log(`Gateway did not report deep-healthy within ${deadlineMs}ms (${attempts} probe(s)); last reason: ${lastReason}`)
  return { healthy: false, attempts, waitedMs: now() - started, lastReason }
}

// Composed assertion used by launch-time recovery: bring the runtime back up and
// require BOTH the foreground serve health AND the background gateway deep
// process-liveness. Reused (in spirit) by the update flow's recoverRuntime,
// which injects the same collaborators granularly so its step ordering stays
// independently testable.
async function assertFullHealth(
  command,
  {
    ensureGateway = ensureGatewayBackground,
    start = startHermes,
    api = hermesApi,
    assertGatewayDeep = assertGatewayDeepHealthy
  } = {}
) {
  await ensureGateway(command)
  const runtime = await start()
  if (!runtime.running) throw new Error(runtime.error || 'Hermes did not restart')
  const health = await api('/api/health')
  if (!health?.ok) throw new Error('Hermes failed its foreground health check')
  await assertGatewayDeep(command)
  return { runtime, health }
}

module.exports = {
  interpretGatewayDeep,
  parseWindowsGatewayDeep,
  assertGatewayDeepHealthy,
  assertFullHealth,
  waitForGatewayDeepHealth,
  GATEWAY_SETTLE_POLL_MS,
  GATEWAY_SETTLE_DEADLINE_MS,
  REQUIRED_PROBE_IDS,
  REQUIRED_PASS_IDS,
  ADVISORY_PROBE_IDS
}
