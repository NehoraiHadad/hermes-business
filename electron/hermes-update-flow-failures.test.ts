import { describe, expect, it } from 'vitest'
import { GATEWAY_SETTLE_POLL_MS } from './hermes-health.cjs'
import { runOfficialUpdate, recoverRuntime } from './hermes-update-flow.cjs'
import { UPDATE_SETTLE_DEADLINE_MS } from './update-runtime.cjs'
import { makeDeps, ANCHOR, COMMAND, PRE_UPDATE_CODE, POST_UPDATE_CODE } from './hermes-update-flow.fixtures'

// Failure & rollback orderings. The happy path lives in
// hermes-update-flow.test.ts.

describe('runOfficialUpdate — pre-mutation aborts (nothing on the checkout changed)', () => {
  it('gates an unsupported install method BEFORE stopping, backing up, or journaling', async () => {
    const { deps, calls } = makeDeps({ methodThrows: true })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('unsupported install method')
    expect(calls).not.toContain('stop')
    expect(calls).not.toContain('backup')
    expect(calls).not.toContain('run:update --yes')
    expect(calls).not.toContain('journal:begin')
    expect(calls.some(c => c.startsWith('rollback:'))).toBe(false)
  })

  it('aborts on the offline/unreachable preflight before stopping or journaling', async () => {
    const { deps, calls } = makeDeps({ reachableThrows: true })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('release source unreachable')
    expect(calls).toContain('methodGate')
    expect(calls).toContain('releaseReachable')
    expect(calls).not.toContain('journal:begin')
    expect(calls).not.toContain('stop')
    expect(calls).not.toContain('backup')
    expect(calls).not.toContain('run:update --yes')
  })

  it('aborts on the compat target preflight before stopping the runtime', async () => {
    const { deps, calls } = makeDeps({ targetThrows: true })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('target out of range')
    expect(calls).toContain('targetPreflight')
    expect(calls).not.toContain('journal:begin')
    expect(calls).not.toContain('stop')
    expect(calls).not.toContain('backup')
  })

  it('aborts when the backup fails verification, without running update --yes, and clears the journal', async () => {
    const { deps, calls } = makeDeps({ backupThrows: true })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('backup verification failed')
    expect(calls).toContain('journal:begin')
    expect(calls).toContain('stop')
    expect(calls).toContain('backup')
    expect(calls).not.toContain('run:update --yes')
    // Backup failed before mutation → no rollback, journal cleared, runtime recovered.
    expect(calls.some(c => c.startsWith('rollback:'))).toBe(false)
    expect(calls).toContain('journal:clear:aborted-before-mutation')
    expect(calls).toContain('start')
  })
})

describe('runOfficialUpdate — post-mutation failure & rollback', () => {
  it('treats a broken gateway deep health as a post-mutation failure — rolls back, never reports success', async () => {
    // Foreground serve is healthy (start ok + /api/health ok) but the gateway
    // deep probe fails. Because deep health stays broken, even the post-rollback
    // recovery fails, so we must NOT claim the system is running — the honest
    // error propagates and the journal is preserved for launch-time recovery.
    const { deps, calls } = makeDeps({ deepThrows: true })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('gateway deep probe failed')
    expect(calls).toContain('run:update --yes')
    expect(calls).toContain('health')
    expect(calls).toContain('deepHealth')
    expect(calls).toContain(`rollback:${ANCHOR}`)
    // Never cleared: both healths never passed together.
    expect(calls).not.toContain('journal:clear:rolled-back')
    expect(calls).not.toContain('journal:clear:completed')
  })

  it('fails closed and rolls back when the update lands an UNSUPPORTED version', async () => {
    const { deps, calls } = makeDeps({ postVersion: '0.21.0' })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('שוחזרה לגרסה הקודמת')
    expect(calls).toContain('run:update --yes')
    expect(calls).toContain('regate')
    expect(calls).toContain(`rollback:${ANCHOR}`)
    expect(calls).toContain('journal:clear:rolled-back')
  })

  it('fails closed and rolls back when the post-update version is UNRESOLVABLE', async () => {
    const { deps, calls } = makeDeps({ postVersion: null })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('שוחזרה לגרסה הקודמת')
    expect(calls).toContain('regate')
    expect(calls).toContain(`rollback:${ANCHOR}`)
  })

  it('rolls back to the anchor and recovers when update --yes fails after mutation', async () => {
    const { deps, calls } = makeDeps({ updateYesThrows: true })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('שוחזרה לגרסה הקודמת')
    expect(calls).toContain('run:update --yes')
    expect(calls).toContain('journal:fail')
    expect(calls).toContain(`rollback:${ANCHOR}`)
    expect(calls.lastIndexOf('start')).toBeGreaterThan(calls.indexOf(`rollback:${ANCHOR}`))
    expect(calls).toContain('journal:clear:rolled-back')
  })

  it('fails closed with the manual-support message when a post-mutation rollback cannot restore', async () => {
    const { deps, calls } = makeDeps({
      updateYesThrows: true,
      rollbackResult: {
        restored: false,
        method: 'non-git',
        message: 'FAILCLOSED: backup at /backups/pre-update.zip — contact support'
      }
    })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('FAILCLOSED')
    // Not restored → journal is PRESERVED for launch-time recovery (never cleared).
    expect(calls).not.toContain('journal:clear:rolled-back')
    expect(calls).not.toContain('journal:clear:completed')
  })

  it('treats a failed post-update foreground health check as a post-mutation failure and rolls back', async () => {
    // The runtime never comes healthy after update --yes (and stays broken after
    // the rollback too), so we roll back but never falsely report it running.
    const { deps, calls } = makeDeps({ startResult: { running: false, error: 'never healthy' } })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('never healthy')
    expect(calls).toContain('run:update --yes')
    expect(calls).toContain(`rollback:${ANCHOR}`)
    expect(calls).not.toContain('journal:clear:rolled-back')
  })

  it('preserves the journal when the rollback restores but the restart is still broken', async () => {
    // Rollback resets the checkout, but recovery after it never comes healthy →
    // journal must stay for the next launch and the original error surfaces.
    const { deps, calls } = makeDeps({
      updateYesThrows: true,
      startResult: { running: false, error: 'still broken after rollback' },
      rollbackResult: { restored: true, method: 'git', commit: ANCHOR }
    })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('update --yes failed')
    expect(calls).toContain(`rollback:${ANCHOR}`)
    expect(calls).not.toContain('journal:clear:rolled-back')
    expect(calls).not.toContain('journal:clear:completed')
  })

  it('rolls back even when the anchor is null (rollback layer decides fail-closed)', async () => {
    const { deps, calls } = makeDeps({
      updateYesThrows: true,
      anchor: null,
      rollbackResult: { restored: false, method: 'git', message: 'no anchor — see backup' }
    })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('no anchor')
    expect(calls).toContain('rollback:null')
  })

  it('does not mask the rolled-back message when the journal clear is unverifiable', async () => {
    // Rollback restores + recovers, but the journal clear can't confirm removal.
    // The accurate "restored to previous version" message must still surface
    // (launch-time recovery will reconcile the surviving journal).
    const { deps } = makeDeps({ updateYesThrows: true, clearThrowsOn: 'rolled-back' })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('שוחזרה לגרסה הקודמת')
  })
})

// ── The settle race at its most dangerous call site ──────────────────────────
// stopOfficialSurfaces ran `gateway stop --all`, so recoverRuntime's
// ensureGatewayBackground is GUARANTEED to start a fresh gateway, which needs
// ~15-16 s to reach gateway_state.json state='running' (deep probe [5]) — measured
// live twice on 2026-08-18. Sampling that too early throws, which routes into the
// post-mutation branch and `git reset`s a SUCCESSFUL update. These tests pin the
// bounded wait that closes the race, and — the half that gives the other half its
// meaning — pin that a genuinely broken update still rolls back.

describe('runOfficialUpdate — bounded settle wait before the destructive rollback', () => {
  it('a still-settling gateway is WAITED for: the update succeeds and is NOT rolled back', async () => {
    // The gateway reports FAIL until +16 s of simulated time, exactly like the
    // measured runs; nothing else about the install is wrong.
    const { deps, calls, clock } = makeDeps({ gatewaySettlesAtMs: 16_000 })
    const result = await runOfficialUpdate(deps)

    expect(result).toMatchObject({ ok: true, completed: true, version: '0.19.1' })
    // THE POINT: no `git reset` of a healthy, landed update.
    expect(calls.some(c => c.startsWith('rollback:'))).toBe(false)
    expect(calls).toContain('journal:clear:completed')
    // 4 failing probes (t=0,5,10,15 s), a passing one at t=20 s, then the gate.
    expect(clock.elapsed()).toBe(4 * GATEWAY_SETTLE_POLL_MS)
    expect(calls.filter(c => c === 'deepHealth')).toHaveLength(6)
  })

  it('REGRESSION GUARD: the same scenario with no wait budget rolls back — that was the bug', async () => {
    // settleDeadlineMs: 0 reproduces exactly what shipped (one immediate sample).
    // If this ever stops rolling back, the test above has stopped proving anything.
    const { deps, calls, clock } = makeDeps({ gatewaySettlesAtMs: 16_000, settleDeadlineMs: 0 })
    await expect(runOfficialUpdate(deps)).rejects.toThrow()

    expect(clock.elapsed()).toBe(0)
    expect(calls).toContain(`rollback:${ANCHOR}`)
    expect(calls).not.toContain('journal:clear:completed')
  })

  it('FAIL-CLOSED: a genuinely broken gateway still rolls back, same anchor and same copy', async () => {
    // deepThrows never recovers, so the wait burns its whole deadline twice (once
    // per recoverRuntime call) and the outcome is byte-for-byte the pre-wait one.
    const { deps, calls } = makeDeps({ deepThrows: true })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('gateway deep probe failed')
    expect(calls).toContain(`rollback:${ANCHOR}`)
    expect(calls).not.toContain('journal:clear:rolled-back')
    expect(calls).not.toContain('journal:clear:completed')
  })

  it('BOUNDED: the wait stops at this call site 180 s deadline, twice at worst', async () => {
    const { deps, calls, clock } = makeDeps({ deepThrows: true })
    await expect(runOfficialUpdate(deps)).rejects.toThrow()

    // Per recoverRuntime call: one immediate sample plus one per poll interval up
    // to the deadline, then the gate's own single probe.
    const probesPerCall = UPDATE_SETTLE_DEADLINE_MS / GATEWAY_SETTLE_POLL_MS + 1 + 1
    expect(probesPerCall).toBe(38)
    // recoverRuntime runs twice on this path: the post-update attempt and the
    // post-rollback attempt. Both are bounded; neither is unbounded.
    expect(calls.filter(c => c === 'deepHealth')).toHaveLength(2 * probesPerCall)
    expect(clock.elapsed()).toBe(2 * UPDATE_SETTLE_DEADLINE_MS)
  })

  it('BOUNDED: a frozen clock still terminates (the attempt cap is clock-independent)', async () => {
    const { deps, calls } = makeDeps({ deepThrows: true })
    // Freeze time and make sleeping a no-op: only the derived attempt cap can
    // stop the loop now.
    deps.now = () => 42
    deps.sleep = async () => {}
    await expect(runOfficialUpdate(deps)).rejects.toThrow()
    expect(calls.filter(c => c === 'deepHealth')).toHaveLength(2 * 38)
  })

  it('the post-rollback recovery gets the wait too, not just the success path', async () => {
    // `update --yes` itself fails, so the gateway is still STOPPED when the
    // post-rollback recoverRuntime runs and ensureGatewayBackground starts a fresh
    // one — the full settle window applies there as well. Without a wait on that
    // call we would falsely report that the ROLLBACK failed to restore a healthy
    // system, which is a worse lie than the one being fixed.
    const { deps, calls } = makeDeps({ updateYesThrows: true, gatewaySettlesAtMs: 16_000 })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('שוחזרה לגרסה הקודמת')
    expect(calls).toContain(`rollback:${ANCHOR}`)
    // Rollback restored AND the recovery was verified healthy → journal cleared.
    expect(calls).toContain('journal:clear:rolled-back')
    // The only recoverRuntime on this path is the post-rollback one, and it waited.
    expect(calls.filter(c => c === 'deepHealth').length).toBeGreaterThan(1)
  })

  it('does not burn the settle deadline when the FOREGROUND runtime is what failed', async () => {
    // startHermes never comes healthy: recoverRuntime must throw before the wait,
    // so a broken foreground does not pay for a gateway it never got to probe.
    const { deps, calls, clock } = makeDeps({ startResult: { running: false, error: 'never healthy' } })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('never healthy')
    expect(calls).not.toContain('deepHealth')
    expect(clock.elapsed()).toBe(0)
  })

  it('BOUNDED: a longer budget than the launch-path recoveries is not assumed — it is stated', () => {
    // Same 180 s the repo already grants `gateway install --start-now`, which is
    // the command ensureGatewayBackground issues inside this very function.
    expect(UPDATE_SETTLE_DEADLINE_MS).toBe(180_000)
  })
})

// -- The rollback must be VERIFIED AGAINST THE RESTORED CODE ------------------
// rollbackAfterFailedUpdate resets the checkout and stops nothing, so without an
// explicit stop the surfaces keep running the code that was just reverted, and
// both halves of recoverRuntime are no-ops against them (ensureGatewayBackground
// early-returns on a running gateway; startHermes early-returns on a running
// serve). The fixture models CHECKOUT and RUNNING code separately and records
// which code each health probe actually covered, so these tests assert the proof
// itself rather than merely that a stop was called.

describe('runOfficialUpdate - the post-rollback health proof covers the restored code', () => {
  it('REGRESSION GUARD: rollback-then-recover with NO stop proves the REVERTED code healthy', async () => {
    // Exactly what shipped: `rollbackAfterFailedUpdate(...)` followed straight by
    // `recoverRuntime(...)`. Drive the fixture into the state the version re-gate
    // reaches - surfaces restarted from the NEW checkout, checkout then reverted -
    // and watch the health proof come back green about the wrong code.
    const { deps, proofs, runningCode } = makeDeps()
    await deps.stopHermes()
    await deps.runCaptured(COMMAND, ['gateway', 'stop', '--all'])
    await deps.runCaptured(COMMAND, ['update', '--yes'])
    await deps.ensureGatewayBackground(COMMAND)
    await deps.startHermes()
    expect(runningCode()).toMatchObject({ serve: POST_UPDATE_CODE, gateway: POST_UPDATE_CODE })
    deps.rollbackAfterFailedUpdate({ anchor: ANCHOR })
    // Checkout is restored; the PROCESSES are not.
    expect(runningCode()).toMatchObject({ checkout: PRE_UPDATE_CODE, serve: POST_UPDATE_CODE })
    proofs.length = 0

    await expect(recoverRuntime(COMMAND, deps)).resolves.toBeTruthy()

    // Green - about the code the rollback was supposed to remove. That is the bug.
    expect(proofs).toEqual([
      `serve:${POST_UPDATE_CODE}`,
      `gateway:${POST_UPDATE_CODE}`,
      `gateway:${POST_UPDATE_CODE}`
    ])
  })

  it('the version re-gate rollback is now verified against the RESTORED version', async () => {
    // The sharpest case: the update lands an unsupported version, so the flow
    // reverts the checkout and must not then certify the rejected code as healthy.
    const { deps, calls, proofs, runningCode } = makeDeps({ postVersion: '0.21.0' })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('שוחזרה לגרסה הקודמת')

    // The whole proof history, in order: the first three verify the landed update
    // (correctly, about the NEW code), and every proof taken after the rollback is
    // about the RESTORED code. Before the stop, those last three read POST.
    expect(proofs).toEqual([
      `serve:${POST_UPDATE_CODE}`,
      `gateway:${POST_UPDATE_CODE}`,
      `gateway:${POST_UPDATE_CODE}`,
      `serve:${PRE_UPDATE_CODE}`,
      `gateway:${PRE_UPDATE_CODE}`,
      `gateway:${PRE_UPDATE_CODE}`
    ])
    // ...and the processes really are running it, not just the checkout.
    expect(runningCode()).toEqual({
      serve: PRE_UPDATE_CODE,
      gateway: PRE_UPDATE_CODE,
      checkout: PRE_UPDATE_CODE
    })
    // Only now may the transaction call itself rolled back and running.
    expect(calls).toContain('journal:clear:rolled-back')
  })

  it('the stop lands AFTER the rollback and BEFORE the restart it is supposed to precede', async () => {
    const { deps, calls } = makeDeps({ postVersion: '0.21.0' })
    await expect(runOfficialUpdate(deps)).rejects.toThrow()
    const rollbackAt = calls.indexOf(`rollback:${ANCHOR}`)
    const stopAt = calls.indexOf('stop', rollbackAt)
    const gatewayStopAt = calls.indexOf('run:gateway stop --all', rollbackAt)
    const ensureAt = calls.indexOf('ensureGw', rollbackAt)
    expect(rollbackAt).toBeGreaterThan(-1)
    expect(stopAt).toBeGreaterThan(rollbackAt)
    expect(gatewayStopAt).toBeGreaterThan(stopAt)
    expect(ensureAt).toBeGreaterThan(gatewayStopAt)
  })

  it('is a harmless no-op when update --yes itself failed and the surfaces are already down', async () => {
    // Case (a): the pre-mutation stop already took the surfaces down and nothing
    // restarted them, so the second stop costs nothing and the restart still
    // brings up the restored code.
    const { deps, calls, proofs, runningCode } = makeDeps({ updateYesThrows: true })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('שוחזרה לגרסה הקודמת')
    expect(calls.filter(c => c === 'stop')).toHaveLength(2)
    expect(proofs.at(-1)).toBe(`gateway:${PRE_UPDATE_CODE}`)
    expect(runningCode()).toMatchObject({ serve: PRE_UPDATE_CODE, gateway: PRE_UPDATE_CODE })
    expect(calls).toContain('journal:clear:rolled-back')
  })

  it('FAIL-CLOSED: a stop we could not complete is never reported as a recovered restore', async () => {
    // If the stop fails we cannot prove the surfaces were restarted from the
    // restored code, so the restore is UNPROVEN - journal preserved for launch-time
    // recovery, honest original error, and never a success claim.
    const { deps, calls } = makeDeps({ updateYesThrows: true, postRollbackStopThrows: true })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('update --yes failed')
    expect(calls).toContain(`rollback:${ANCHOR}`)
    expect(calls).not.toContain('journal:clear:rolled-back')
    expect(calls).not.toContain('journal:clear:completed')
    // The stop threw before anything could be restarted or probed post-rollback.
    expect(calls.lastIndexOf('ensureGw')).toBeLessThan(calls.indexOf(`rollback:${ANCHOR}`))
  })

  it('FAIL-CLOSED: a restart that comes back broken still fails, with the journal preserved', async () => {
    // The stop succeeded, the restored code came up UNhealthy. Unchanged outcome:
    // no clear, original error, journal left for the next launch.
    const { deps, calls } = makeDeps({
      updateYesThrows: true,
      startResult: { running: false, error: 'still broken after rollback' }
    })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('update --yes failed')
    expect(calls).toContain(`rollback:${ANCHOR}`)
    expect(calls).not.toContain('journal:clear:rolled-back')
  })

  it('the pre-mutation abort branch is NOT given a second stop (nothing was reverted there)', async () => {
    // Backup verification fails before any mutation: the checkout never changed, so
    // whatever is running already matches it and a stop/restart would be pointless
    // churn. Exactly one stop, from the pre-mutation phase.
    const { deps, calls } = makeDeps({ backupThrows: true })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('backup verification failed')
    expect(calls.filter(c => c === 'stop')).toHaveLength(1)
    expect(calls.some(c => c.startsWith('rollback:'))).toBe(false)
    expect(calls).toContain('journal:clear:aborted-before-mutation')
  })
})

// -- The one door the stop cannot close by itself ----------------------------
// stopOfficialSurfaces swallows a failed `gateway stop --all` by design, so the
// stop can "succeed" while the old gateway survives. ensureGatewayBackground then
// early-returns on it and the deep assertion certifies the REVERTED code again --
// the same false claim, arriving silently. The post-rollback call site therefore
// PROVES the gateway is gone with the authoritative reader before it trusts any
// restart, and refuses on anything that is not a positive `stopped`.

describe('runOfficialUpdate - the post-rollback stop is PROVEN, not assumed', () => {
  it('happy path: the reader confirms `stopped`, so the restart and its proof stand', async () => {
    const { deps, calls, proofs, runningCode } = makeDeps({ postVersion: '0.21.0' })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('שוחזרה לגרסה הקודמת')
    // The verification happened, between the stop and the restart...
    const stopAt = calls.indexOf('run:gateway stop --all', calls.indexOf(`rollback:${ANCHOR}`))
    expect(calls.indexOf('gatewayState')).toBeGreaterThan(stopAt)
    expect(calls.indexOf('ensureGw', stopAt)).toBeGreaterThan(calls.indexOf('gatewayState'))
    // ...and it changed nothing about the outcome: fresh gateway from the restored
    // checkout, proof taken against the restored code, journal cleared.
    expect(proofs.slice(-3)).toEqual([
      `serve:${PRE_UPDATE_CODE}`,
      `gateway:${PRE_UPDATE_CODE}`,
      `gateway:${PRE_UPDATE_CODE}`
    ])
    expect(runningCode()).toMatchObject({ gateway: PRE_UPDATE_CODE })
    expect(calls).toContain('journal:clear:rolled-back')
  })

  it('REGRESSION GUARD: a SILENTLY failed gateway stop leaves the reverted code running', async () => {
    // The model tells the truth here: the stop threw nothing (stopOfficialSurfaces
    // swallowed it) but the gateway kept running the reverted code. Before the
    // reader check, ensureGatewayBackground would have early-returned on it and the
    // deep assertion would have certified `code@post-update` as a healthy restore.
    const { deps, calls, proofs, runningCode } = makeDeps({
      postVersion: '0.21.0',
      postRollbackGatewayStopSilentlyFails: true
    })
    await expect(runOfficialUpdate(deps)).rejects.toThrow()

    // The survivor is real, and it is the code the rollback was meant to remove.
    expect(runningCode()).toMatchObject({ gateway: POST_UPDATE_CODE, checkout: PRE_UPDATE_CODE })
    // NOTHING was certified after the rollback -- no false green, and no green at
    // all. The only proofs on record are the pre-rollback ones about the new code.
    expect(proofs).toEqual([
      `serve:${POST_UPDATE_CODE}`,
      `gateway:${POST_UPDATE_CODE}`,
      `gateway:${POST_UPDATE_CODE}`
    ])
    // Fail closed: no restart was attempted, journal preserved for the next launch.
    expect(calls.lastIndexOf('ensureGw')).toBeLessThan(calls.indexOf(`rollback:${ANCHOR}`))
    expect(calls).not.toContain('journal:clear:rolled-back')
    expect(calls).not.toContain('journal:clear:completed')
    expect(calls.filter(c => c === 'journal:fail').length).toBeGreaterThan(1)
  })

  it('the refusal surfaces the ORIGINAL failure, never a restored-and-running claim', async () => {
    const { deps } = makeDeps({ updateYesThrows: true, postRollbackGatewayStopSilentlyFails: true })
    // outcome.restored is true (the checkout WAS reset) but the restore is unproven,
    // so the owner gets the real reason, not "שוחזרה לגרסה הקודמת ... והמערכת פועלת".
    await expect(runOfficialUpdate(deps)).rejects.toThrow('update --yes failed')
  })

  it('`unknown` fails closed exactly like `running` -- could-not-look is not proof', async () => {
    // The reader returns `unknown` when the binary is missing, the spawn failed, or
    // the output was unparseable. None of those establish that the old gateway is
    // gone, so none of them may authorise a restore claim.
    const { deps, calls, proofs } = makeDeps({ postVersion: '0.21.0', gatewayStateAfterStop: 'unknown' })
    await expect(runOfficialUpdate(deps)).rejects.toThrow()
    expect(calls).toContain('gatewayState')
    expect(calls.lastIndexOf('ensureGw')).toBeLessThan(calls.indexOf(`rollback:${ANCHOR}`))
    expect(proofs.every(pr => pr.endsWith(POST_UPDATE_CODE))).toBe(true)
    expect(calls).not.toContain('journal:clear:rolled-back')
  })

  it('the verification is scoped to the post-rollback stop only', async () => {
    // The PRE-mutation stop keeps its swallow: a noisy stop must never abort an
    // update, and stopOfficialSurfaces itself is unchanged. So the reader is
    // consulted exactly once, and only after a rollback.
    const { deps, calls } = makeDeps({ postVersion: '0.21.0' })
    await expect(runOfficialUpdate(deps)).rejects.toThrow()
    expect(calls.filter(c => c === 'gatewayState')).toHaveLength(1)

    // ...and not at all on a path that never rolls back.
    const clean = makeDeps()
    await runOfficialUpdate(clean.deps)
    expect(clean.calls).not.toContain('gatewayState')

    // ...nor on the pre-mutation abort branch, which reverts nothing.
    const aborted = makeDeps({ backupThrows: true })
    await expect(runOfficialUpdate(aborted.deps)).rejects.toThrow('backup verification failed')
    expect(aborted.calls).not.toContain('gatewayState')
  })
})
