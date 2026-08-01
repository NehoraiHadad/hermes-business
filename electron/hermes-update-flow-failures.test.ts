import { describe, expect, it } from 'vitest'
import { runOfficialUpdate } from './hermes-update-flow.cjs'
import { makeDeps, ANCHOR } from './hermes-update-flow.fixtures'

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
    const { deps, calls } = makeDeps({ postVersion: '0.20.0' })
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
