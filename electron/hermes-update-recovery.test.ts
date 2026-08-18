import { describe, expect, it, vi } from 'vitest'
import { GATEWAY_SETTLE_POLL_MS } from './hermes-health.cjs'
import { ROLLBACK_SETTLE_DEADLINE_MS, recoverIncompleteUpdate } from './hermes-update-recovery.cjs'

const CMD = '/home/hermes-agent/venv/bin/hermes'
const RECORD = { phase: 'mutating', method: 'git', anchor: 'abc123', backupPath: '/b/pre.zip' }
// The Hebrew copy the UI shows when a rollback restored the checkout but health
// still fails. Pinned here so the settle wait cannot quietly reword it.
const ROLLED_BACK_UNHEALTHY_COPY =
  'שחזור העדכון הוחזר לגרסה הקודמת אך בדיקות הבריאות עדיין נכשלות; פנה לתמיכה.'

// A FAKE CLOCK, not a real one: `sleep` never sleeps, it only advances `now`, so
// these tests measure the exact simulated time and probe count the real code
// would burn without any test ever waiting.
function makeClock() {
  let t = 1_000_000
  return {
    now: () => t,
    sleep: vi.fn(async (ms: number) => {
      t += ms
    }),
    elapsed: () => t - 1_000_000
  }
}

function makeDeps(overrides: Partial<Record<string, unknown>> = {}) {
  const clock = makeClock()
  const deps = {
    detect: vi.fn().mockReturnValue(RECORD),
    resolveCommand: vi.fn().mockReturnValue(CMD),
    fullHealth: vi.fn().mockResolvedValue({ health: { ok: true } }),
    rollback: vi.fn().mockReturnValue({ restored: true, method: 'git', commit: 'abc123' }),
    fail: vi.fn(),
    clear: vi.fn(),
    // Injected by DEFAULT so no test can reach the real hermes-health.cjs (which
    // would spawn a live `hermes gateway status --deep`) or the real setTimeout.
    // The wait LOOP under test is still the real shared waitForGatewayDeepHealth.
    assertGatewayDeep: vi.fn().mockResolvedValue({ healthy: true }),
    sleep: clock.sleep,
    now: clock.now,
    log: vi.fn(),
    ...overrides
  }
  return Object.assign(deps, { clock })
}

describe('recoverIncompleteUpdate — launch-time deterministic recovery', () => {
  it('does nothing when there is no incomplete journal', async () => {
    const deps = makeDeps({ detect: vi.fn().mockReturnValue(null) })
    const result = await recoverIncompleteUpdate(deps)
    expect(result).toMatchObject({ recovered: false, action: 'none' })
    expect(deps.fullHealth).not.toHaveBeenCalled()
    expect(deps.clear).not.toHaveBeenCalled()
  })

  it('clears the journal when the install is already verified-healthy (update landed pre-crash)', async () => {
    const deps = makeDeps()
    const result = await recoverIncompleteUpdate(deps)
    expect(result).toMatchObject({ recovered: true, action: 'already-healthy' })
    expect(deps.clear).toHaveBeenCalledWith({ outcome: 'recovered-healthy' })
    expect(deps.rollback).not.toHaveBeenCalled()
  })

  it('rolls back to the anchor and clears only after BOTH healths pass post-rollback', async () => {
    // First full-health (as-is) fails; second (after rollback) passes.
    const fullHealth = vi
      .fn()
      .mockRejectedValueOnce(new Error('unhealthy after crash'))
      .mockResolvedValueOnce({ health: { ok: true } })
    const deps = makeDeps({ fullHealth })
    const result = await recoverIncompleteUpdate(deps)
    expect(result).toMatchObject({ recovered: true, action: 'rolled-back', commit: 'abc123' })
    expect(deps.rollback).toHaveBeenCalledWith({ command: CMD, anchor: 'abc123', backupPath: '/b/pre.zip' })
    expect(deps.clear).toHaveBeenCalledWith({ outcome: 'recovered-rolledback' })
  })

  it('preserves the journal (no clear) when rollback restores but health still fails', async () => {
    const deps = makeDeps({ fullHealth: vi.fn().mockRejectedValue(new Error('still broken')) })
    const result = await recoverIncompleteUpdate(deps)
    expect(result).toMatchObject({ recovered: false, action: 'rolled-back-unhealthy' })
    expect(deps.clear).not.toHaveBeenCalled()
    expect(deps.fail).toHaveBeenCalled()
  })

  it('fails closed (journal preserved) when the rollback cannot restore', async () => {
    const deps = makeDeps({
      fullHealth: vi.fn().mockRejectedValue(new Error('unhealthy')),
      rollback: vi.fn().mockReturnValue({ restored: false, method: 'non-git', message: 'see backup /b/pre.zip' })
    })
    const result = await recoverIncompleteUpdate(deps)
    expect(result).toMatchObject({ recovered: false, action: 'fail-closed', message: 'see backup /b/pre.zip' })
    expect(deps.clear).not.toHaveBeenCalled()
  })

  it('reports honestly when Hermes is not installed during recovery', async () => {
    const deps = makeDeps({ resolveCommand: vi.fn().mockReturnValue(null) })
    const result = await recoverIncompleteUpdate(deps)
    expect(result).toMatchObject({ recovered: false, action: 'no-command' })
    expect(deps.fullHealth).not.toHaveBeenCalled()
  })
})

// ── The settle race, and why it is worse HERE than in the companion updater ──
// Failing the step-2 health check is what AUTHORISES a destructive `git reset` of
// the install checkout. The gateway needs ~15-16 s after a restart to reach
// gateway_state.json state='running' (deep probe [5]) — measured live twice on
// 2026-08-18 — and this call site samples earlier in main.cjs's launch sequence
// than any other. Sampling too early therefore does not merely cry wolf: it
// DESTROYS a landed update. These tests pin the bounded wait that closes that
// race and, more importantly, pin that a genuinely broken update still rolls back
// exactly as it always did.

describe('recoverIncompleteUpdate — bounded wait before the destructive decision', () => {
  // A faithful model of the measured race: BOTH the deep probe and the composed
  // health assertion fail until the gateway has settled at +16 s of simulated
  // time, then both pass. Nothing else about the install is wrong.
  function makeSettlingDeps(settleAtMs: number, overrides: Partial<Record<string, unknown>> = {}) {
    const clock = makeClock()
    const settled = () => clock.elapsed() >= settleAtMs
    const notReady = () =>
      new Error('בדיקת חיוּת עומק של תהליך שער Hermes נכשלה: deep liveness probe(s) [5] reported FAIL')
    // Object.assign last: the deps must expose THIS clock, not makeDeps's unused
    // default one, or the elapsed-time assertions would silently read zero.
    return Object.assign(
      makeDeps({
        sleep: clock.sleep,
        now: clock.now,
        assertGatewayDeep: vi.fn(async () => {
          if (!settled()) throw notReady()
          return { healthy: true }
        }),
        fullHealth: vi.fn(async () => {
          if (!settled()) throw notReady()
          return { health: { ok: true } }
        }),
        ...overrides
      }),
      { clock }
    )
  }

  it('a still-settling gateway is WAITED for, not rolled back', async () => {
    const deps = makeSettlingDeps(16_000)
    const result = await recoverIncompleteUpdate(deps)

    expect(result).toMatchObject({ recovered: true, action: 'already-healthy' })
    // THE POINT OF THIS WHOLE CHANGE: no destructive reset of a landed update.
    expect(deps.rollback).not.toHaveBeenCalled()
    expect(deps.clear).toHaveBeenCalledWith({ outcome: 'recovered-healthy' })
    expect(deps.fail).not.toHaveBeenCalled()
    // 4 failing probes (t=0,5,10,15 s) then a pass at t=20 s.
    expect(deps.assertGatewayDeep).toHaveBeenCalledTimes(5)
    expect(deps.sleep).toHaveBeenCalledTimes(4)
    expect(deps.clock.elapsed()).toBe(4 * GATEWAY_SETTLE_POLL_MS)
    expect(deps.fullHealth).toHaveBeenCalledTimes(1)
  })

  it('REGRESSION GUARD: the same scenario with no wait budget rolls back — that was the bug', async () => {
    // settleDeadlineMs: 0 reproduces the shipped behaviour (one immediate sample).
    // If this ever stops rolling back, the test above has stopped proving anything.
    const deps = makeSettlingDeps(16_000, { settleDeadlineMs: 0 })
    const result = await recoverIncompleteUpdate(deps)

    expect(deps.assertGatewayDeep).toHaveBeenCalledTimes(1)
    expect(deps.sleep).not.toHaveBeenCalled()
    expect(deps.rollback).toHaveBeenCalled()
    expect(result.action).not.toBe('already-healthy')
  })

  it('waits BEFORE the gate, and does NOT wait again around the post-rollback assertion', async () => {
    const calls: string[] = []
    const clock = makeClock()
    let probes = 0
    let checks = 0
    const deps = makeDeps({
      sleep: clock.sleep,
      now: clock.now,
      assertGatewayDeep: vi.fn(async () => {
        probes += 1
        calls.push(`probe:${probes}`)
        if (probes <= 2) throw new Error('probe [5] FAIL')
        return { healthy: true }
      }),
      fullHealth: vi.fn(async () => {
        checks += 1
        calls.push(`fullHealth:${checks}`)
        if (checks === 1) throw new Error('unhealthy after crash')
        return { health: { ok: true } }
      }),
      rollback: vi.fn(() => {
        calls.push('rollback')
        return { restored: true, method: 'git', commit: 'abc123' }
      })
    })
    const result = await recoverIncompleteUpdate(deps)

    expect(result).toMatchObject({ recovered: true, action: 'rolled-back' })
    // No second wait around the post-rollback assertion: `git reset` never
    // restarts the gateway, so there is no new settle window — and reaching this
    // point means the whole deadline was already burned.
    expect(calls).toEqual(['probe:1', 'probe:2', 'probe:3', 'fullHealth:1', 'rollback', 'fullHealth:2'])
  })

  it('FAIL-CLOSED: a genuinely broken install STILL rolls back — same anchor, outcome and copy', async () => {
    const deps = makeDeps({
      // Nothing ever comes up: this gateway is dead, not settling.
      assertGatewayDeep: vi.fn().mockRejectedValue(new Error('probe [5] FAIL')),
      fullHealth: vi
        .fn()
        .mockRejectedValueOnce(new Error('unhealthy after crash'))
        .mockResolvedValueOnce({ health: { ok: true } })
    })
    const result = await recoverIncompleteUpdate(deps)

    // Byte-for-byte the pre-wait behaviour: the wait removed a race, not a gate.
    expect(result).toMatchObject({ recovered: true, action: 'rolled-back', commit: 'abc123' })
    expect(deps.rollback).toHaveBeenCalledWith({ command: CMD, anchor: 'abc123', backupPath: '/b/pre.zip' })
    expect(deps.clear).toHaveBeenCalledWith({ outcome: 'recovered-rolledback' })
    expect(deps.fail).toHaveBeenCalled()
  })

  it('FAIL-CLOSED: still-unhealthy after the rollback keeps the journal and the exact support copy', async () => {
    const deps = makeDeps({
      assertGatewayDeep: vi.fn().mockRejectedValue(new Error('probe [5] FAIL')),
      fullHealth: vi.fn().mockRejectedValue(new Error('still broken'))
    })
    const result = await recoverIncompleteUpdate(deps)

    expect(result).toMatchObject({ recovered: false, action: 'rolled-back-unhealthy' })
    expect(result.message).toBe(ROLLED_BACK_UNHEALTHY_COPY)
    expect(deps.clear).not.toHaveBeenCalled()
  })

  it('FAIL-CLOSED: a rollback that cannot restore still fails closed to the verified backup', async () => {
    const deps = makeDeps({
      assertGatewayDeep: vi.fn().mockRejectedValue(new Error('probe [5] FAIL')),
      fullHealth: vi.fn().mockRejectedValue(new Error('unhealthy')),
      rollback: vi.fn().mockReturnValue({ restored: false, method: 'non-git', message: 'see backup /b/pre.zip' })
    })
    const result = await recoverIncompleteUpdate(deps)
    expect(result).toMatchObject({ recovered: false, action: 'fail-closed', message: 'see backup /b/pre.zip' })
    expect(deps.clear).not.toHaveBeenCalled()
  })

  it('BOUNDED: the wait stops at the 180 s deadline of this call site', async () => {
    const deps = makeDeps({
      assertGatewayDeep: vi.fn().mockRejectedValue(new Error('probe [5] FAIL')),
      fullHealth: vi.fn().mockRejectedValue(new Error('still broken'))
    })
    await recoverIncompleteUpdate(deps)

    // Exact, not "roughly": one immediate sample plus one per poll interval up to
    // the deadline. If someone widens the deadline or drops a bound, this says so.
    const expectedProbes = ROLLBACK_SETTLE_DEADLINE_MS / GATEWAY_SETTLE_POLL_MS + 1
    expect(expectedProbes).toBe(37)
    expect(deps.assertGatewayDeep).toHaveBeenCalledTimes(expectedProbes)
    expect(deps.sleep).toHaveBeenCalledTimes(expectedProbes - 1)
    expect(deps.clock.elapsed()).toBe(ROLLBACK_SETTLE_DEADLINE_MS)
    // ...and every sleep really was the poll interval, never a longer blocking one.
    expect(new Set(deps.sleep.mock.calls.map(c => c[0]))).toEqual(new Set([GATEWAY_SETTLE_POLL_MS]))
  })

  it('BOUNDED: a longer budget than the companion updater, on purpose', () => {
    // This call site samples earlier in the launch sequence AND gates a
    // destructive `git reset`, so it gets the 180 s gateway-ensure.cjs already
    // grants `gateway install --start-now`, not the companion updater's 120 s.
    expect(ROLLBACK_SETTLE_DEADLINE_MS).toBe(180_000)
    expect(ROLLBACK_SETTLE_DEADLINE_MS).toBeGreaterThan(120_000)
  })

  it('BOUNDED: a frozen clock still terminates (the attempt cap is clock-independent)', async () => {
    const deps = makeDeps({
      assertGatewayDeep: vi.fn().mockRejectedValue(new Error('probe [5] FAIL')),
      fullHealth: vi.fn().mockRejectedValue(new Error('still broken')),
      sleep: vi.fn(async () => {}),
      now: () => 42
    })
    const result = await recoverIncompleteUpdate(deps)
    expect(result).toMatchObject({ action: 'rolled-back-unhealthy' })
    expect(deps.assertGatewayDeep).toHaveBeenCalledTimes(37)
  })

  it('never waits on the outcomes that never reach the health gate', async () => {
    const noJournal = makeDeps({ detect: vi.fn().mockReturnValue(null) })
    await expect(recoverIncompleteUpdate(noJournal)).resolves.toMatchObject({ action: 'none' })
    expect(noJournal.assertGatewayDeep).not.toHaveBeenCalled()
    expect(noJournal.sleep).not.toHaveBeenCalled()

    const noCommand = makeDeps({ resolveCommand: vi.fn().mockReturnValue(null) })
    await expect(recoverIncompleteUpdate(noCommand)).resolves.toMatchObject({ action: 'no-command' })
    expect(noCommand.assertGatewayDeep).not.toHaveBeenCalled()
    expect(noCommand.sleep).not.toHaveBeenCalled()
    expect(noCommand.clock.elapsed()).toBe(0)
  })

  it('an already-settled gateway pays one probe and no sleep at all', async () => {
    const deps = makeDeps()
    await expect(recoverIncompleteUpdate(deps)).resolves.toMatchObject({ action: 'already-healthy' })
    expect(deps.assertGatewayDeep).toHaveBeenCalledTimes(1)
    expect(deps.sleep).not.toHaveBeenCalled()
    expect(deps.clock.elapsed()).toBe(0)
  })
})
