const path = require('node:path')

// The runtime-lifecycle helpers that bracket the self-update transaction: bring
// the official Hermes surfaces DOWN before mutating the checkout, and back UP
// (with BOTH health gates) after. Both are pure orchestration over injected
// collaborators — the transaction itself lives in hermes-update-flow.cjs.

// Closes ONLY the Hermes Desktop processes whose executable lives under the
// install root being replaced (never unrelated apps). Runs under -NoProfile
// -NonInteractive; HERMES_UPDATE_ROOT is passed in the environment.
const closeDesktopScript = String.raw`
$root = [IO.Path]::GetFullPath($env:HERMES_UPDATE_ROOT).TrimEnd('\') + '\'
$targets = @(Get-CimInstance Win32_Process | Where-Object {
  $exe = [string]$_.ExecutablePath
  $cmd = [string]$_.CommandLine
  $inside = $exe.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)
  $desktop = $cmd -match '(?i)(^|\s)desktop(\s|$)' -or $exe -match '(?i)\\apps\\desktop\\release\\'
  $inside -and $desktop
})
foreach ($target in ($targets | Sort-Object ProcessId -Descending)) {
  Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 800
Write-Output $targets.Count
`

async function stopOfficialSurfaces(command, deps) {
  const { stopHermes, runCaptured, rememberLog, platform = process.platform } = deps
  await stopHermes()
  await runCaptured(command, ['gateway', 'stop', '--all'], 90_000).catch(error => {
    rememberLog(`Gateway stop before update returned: ${error.message || error}`)
  })
  if (platform !== 'win32') return
  // The executable being replaced is under this install root; close only the
  // Hermes Desktop processes running from inside it (never unrelated apps).
  const root = path.resolve(command, '..', '..', '..')
  await runCaptured(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', closeDesktopScript],
    45_000,
    { HERMES_UPDATE_ROOT: root }
  )
}

// -- Why the gateway deep assertion below WAITS before it samples -------------
// This is the most exposed instance of the gateway settle race in the repo, and
// the one with the most destructive consequence.
//
// stopOfficialSurfaces() above has just run `gateway stop --all`, so by the time
// recoverRuntime runs, ensureGatewayBackground is GUARANTEED to start a fresh
// gateway (its "already running -> do not restart" branch cannot be taken). A
// freshly started gateway needs ~15-16 s to reach gateway_state.json
// state='running' -- deep probe [5] -- almost all of it spent connecting
// platforms (Telegram alone took 10.7 s on attempt 1 of up to 8, measured live
// twice on 2026-08-18; see the note on waitForGatewayDeepHealth in
// hermes-health.cjs). startHermes() plus one /api/health call buy only a few
// seconds of that.
//
// So the settle here is CERTAIN, not merely possible -- and a throw from this
// function routes into hermes-update-flow.cjs post-mutation branch, which calls
// rollbackAfterFailedUpdate -> `git reset` of the user Hermes checkout, and then
// tells the owner the update failed and was reverted. Sampling too early
// therefore destroys a SUCCESSFUL `hermes update --yes` because a chat platform
// had not finished connecting.
//
// The wait lives INSIDE recoverRuntime, so all three of its call sites get it,
// and that is deliberate -- verified against the flow, not assumed:
//   * post-mutation failure branch: rollbackAfterFailedUpdate only `git reset`s
//     the checkout and is NOT followed by a second stopOfficialSurfaces, so the
//     gateway there is either (a) still stopped -- when `update --yes` itself
//     threw, the most common post-mutation failure -- in which case this call
//     starts a fresh gateway and faces the full settle window, or (b) the same
//     young gateway the first assertion just raced, still inside its settle
//     window. Either way it races. If only the success path waited, the
//     post-rollback assertion would falsely report that the ROLLBACK failed to
//     restore a healthy system -- a worse lie than the one being fixed, because
//     by then the fallback is the owner only remaining signal.
//   * pre-mutation abort branch: if we failed at stop/backup the gateway is
//     stopped and this call restarts it (same window); if we failed in preflight
//     nothing was stopped, the first probe passes immediately and the wait costs
//     one probe.
//
// BUDGET: 180 s, and this call site reaches it by its own route.
//   * Internal consistency first: this very function starts the gateway through
//     ensureGatewayBackground, which is allowed 180 s to run `gateway install
//     --start-now`. Waiting for the gateway to become READY exactly as long as we
//     were already willing to wait for the command that STARTS it is the coherent
//     number, not a copied one.
//   * Going higher was considered (the flow is user-initiated, foreground, and
//     already grants `update --yes` 20 minutes, so tolerance for waiting is real).
//     Two things cap it: the settle here is CERTAIN, so unlike the launch-path
//     recoveries this budget is not a rarely-touched safety net; and recoverRuntime
//     can run TWICE per transaction (attempt + post-rollback), so the deadline is
//     effectively doubled on a genuinely broken update. 180 s keeps that worst case
//     at ~6 min inside a transaction that already budgets 20 min for `update --yes`
//     alone, while still being ~11x the measured settle.
//   * The happy path costs ~16 s, not 180: the wait returns on the first passing
//     probe.
// The poll interval is the shared GATEWAY_SETTLE_POLL_MS default (~5 s against a
// probe that itself costs ~5.7 s), so in production the elapsed deadline binds
// first (~16 probes); the loop clock-independent attempt cap (37) is the second,
// belt-and-braces bound.
const UPDATE_SETTLE_DEADLINE_MS = 180_000

// This module is pure orchestration over injected collaborators and deliberately
// carries no top-level impure requires, so the shared wait loop -- which lives
// beside the assertion it polls, in hermes-health.cjs -- is resolved lazily and
// only when a caller did not inject a fake.
function defaultAwaitGatewayHealth(command, options) {
  return require('./hermes-health.cjs').waitForGatewayDeepHealth(command, options)
}

// Bring the runtime back up and require BOTH health surfaces: the foreground
// `hermes serve` (process running + /api/health ok) AND the background gateway
// deep PROCESS/lifecycle liveness (`gateway status --deep`; not a channel/cron
// probe). Throws if either fails, so no caller can ever report restored/running
// unless both actually pass.
async function recoverRuntime(command, deps) {
  const {
    ensureGatewayBackground,
    startHermes,
    hermesApi,
    assertGatewayDeepHealthy,
    // The bounded settle wait and everything it needs, injectable down to the
    // clock and the sleep so the ordering AND the bounds are testable without a
    // test ever actually waiting. `sleep` has no default on purpose: uninjected
    // it stays undefined and the shared loop falls back to its own setTimeout.
    awaitGatewayHealth = defaultAwaitGatewayHealth,
    sleep,
    now = Date.now,
    settleDeadlineMs = UPDATE_SETTLE_DEADLINE_MS,
    settlePollMs,
    rememberLog = () => {}
  } = deps
  await ensureGatewayBackground(command)
  const runtime = await startHermes()
  if (!runtime.running) throw new Error(runtime.error || 'Hermes did not restart after update')
  const health = await hermesApi('/api/health')
  if (!health?.ok) throw new Error('Hermes failed its post-update health check')
  // Bounded, non-mutating wait for the gateway we just restarted to finish coming
  // up -- see the long note above. It is placed HERE, after the foreground work,
  // rather than right after ensureGatewayBackground: startHermes() and the
  // /api/health round-trip take real time and absorb part of the settle for free,
  // and a foreground failure must still throw immediately without burning any of
  // this deadline.
  //
  // ADVISORY ONLY. Whether it succeeds or times out, the SAME single
  // assertGatewayDeepHealthy below runs exactly once and its verdict alone
  // decides. A genuinely broken gateway therefore still throws the identical
  // error, still routes to the identical rollback, and still produces the
  // identical user-facing copy. This removes a race; it does not soften a gate.
  const settle = await awaitGatewayHealth(command, {
    assertGatewayDeep: assertGatewayDeepHealthy,
    sleep,
    now,
    deadlineMs: settleDeadlineMs,
    pollMs: settlePollMs,
    log: rememberLog
  })
  if (!settle.healthy) {
    rememberLog(
      `Gateway still not deep-healthy ${settle.waitedMs}ms after the update restart; running the health gate anyway (its verdict decides whether to roll back)`
    )
  }
  await assertGatewayDeepHealthy(command)
  return { runtime, health }
}

module.exports = { stopOfficialSurfaces, recoverRuntime, closeDesktopScript, UPDATE_SETTLE_DEADLINE_MS }
