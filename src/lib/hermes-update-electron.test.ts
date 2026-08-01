import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Source-order safety contract for the update orchestration. The behavioural
// coverage (every failure ordering + rollback) lives in
// electron/hermes-update-flow.test.ts; this guards that the *sequence* on disk
// stays the safe one, since the ordering is the whole point of the flow.
describe('Hermes update orchestration', () => {
  it('preflights + offline-checks BEFORE stopping/backing up, opens a journal, then mutates and recovers', () => {
    const source = readFileSync(path.resolve('electron/hermes-update-flow.cjs'), 'utf8')
    const methodGate = source.indexOf('assertUpdateMethodSupported(command)')
    const reachable = source.indexOf('assertReleaseReachable(command)')
    const targetPreflight = source.indexOf('assertUpdateTargetSupported(command)')
    const anchor = source.indexOf('captureRollbackAnchor(command)')
    const begin = source.indexOf('journal.beginUpdate(')
    const stop = source.indexOf('await stopOfficialSurfaces(command, deps)')
    const backup = source.indexOf('await createPreUpdateBackup(command)')
    const update = source.indexOf("runCaptured(command, ['update', '--yes']")
    const recover = source.indexOf('await recoverRuntime(command, deps)')

    // Preflight (gate unsupported/no-rollback method + offline + compat target)
    // happens before we tear anything down, so an ineligible or offline update
    // never stops the runtime, backs up, or even opens the journal.
    expect(methodGate).toBeGreaterThan(0)
    expect(reachable).toBeGreaterThan(methodGate)
    expect(targetPreflight).toBeGreaterThan(reachable)
    expect(anchor).toBeGreaterThan(targetPreflight)
    // The durable journal opens after the anchor but BEFORE the first side effect.
    expect(begin).toBeGreaterThan(anchor)
    expect(stop).toBeGreaterThan(begin)
    expect(backup).toBeGreaterThan(stop)
    expect(update).toBeGreaterThan(backup)
    expect(recover).toBeGreaterThan(update)

    // Post-mutation failure path exists: rollback then honest recovery.
    expect(source).toContain('rollbackAfterFailedUpdate({ command, anchor, backupPath })')
    // Journal is cleared only after a verified-healthy completion.
    expect(source).toContain("journal.clearJournal({ outcome: 'completed' })")

    // The runtime-lifecycle helpers that bracket the transaction (stop official
    // surfaces + recover BOTH health surfaces) live in update-runtime.cjs; the
    // flow calls them by name (asserted in the ordering above). Their safety
    // contract — foreground serve health, gateway deep health, and the
    // gateway-stop-before-update — is guarded here.
    const runtime = readFileSync(path.resolve('electron/update-runtime.cjs'), 'utf8')
    expect(runtime).toContain("await hermesApi('/api/health')")
    expect(runtime).toContain('assertGatewayDeepHealthy(command)')
    expect(runtime).toContain("['gateway', 'stop', '--all']")
  })
})
