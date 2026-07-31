import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Source-order safety contract for the update orchestration. The behavioural
// coverage (every failure ordering + rollback) lives in
// electron/hermes-update-flow.test.ts; this guards that the *sequence* on disk
// stays the safe one, since the ordering is the whole point of the flow.
describe('Hermes update orchestration', () => {
  it('preflights BEFORE stopping/backing up, captures a rollback anchor, then mutates and recovers', () => {
    const source = readFileSync(path.resolve('electron/hermes-update-flow.cjs'), 'utf8')
    const methodGate = source.indexOf('assertUpdateMethodSupported(command)')
    const check = source.indexOf("runCaptured(command, ['update', '--check']")
    const targetPreflight = source.indexOf('assertUpdateTargetSupported(command)')
    const anchor = source.indexOf('captureRollbackAnchor(command)')
    const stop = source.indexOf('await stopOfficialSurfaces(command, deps)')
    const backup = source.indexOf('await createPreUpdateBackup(command)')
    const update = source.indexOf("runCaptured(command, ['update', '--yes']")
    const recover = source.indexOf('await recoverRuntime(command, deps)')

    // Preflight (gate unsupported method + compat target) happens before we tear
    // anything down, so an ineligible update never stops the runtime or gateway.
    expect(methodGate).toBeGreaterThan(0)
    expect(check).toBeGreaterThan(methodGate)
    expect(targetPreflight).toBeGreaterThan(check)
    expect(anchor).toBeGreaterThan(targetPreflight)
    // The rollback anchor is captured before ANY mutation (stop/backup/apply).
    expect(stop).toBeGreaterThan(anchor)
    expect(backup).toBeGreaterThan(stop)
    expect(update).toBeGreaterThan(backup)
    expect(recover).toBeGreaterThan(update)

    // Post-mutation failure path exists: rollback then honest recovery.
    expect(source).toContain('rollbackAfterFailedUpdate({ command, anchor, backupPath })')
    expect(source).toContain("await hermesApi('/api/health')")
    expect(source).toContain("['gateway', 'stop', '--all']")
    expect(source).toContain('backupPath')
  })
})
