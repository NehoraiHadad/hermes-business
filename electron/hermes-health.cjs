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
  REQUIRED_PROBE_IDS,
  REQUIRED_PASS_IDS,
  ADVISORY_PROBE_IDS
}
