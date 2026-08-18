import { describe, expect, it } from 'vitest'
import { runOfficialUpdate } from './hermes-update-flow.cjs'
import { makeDeps } from './hermes-update-flow.fixtures'

// Happy-path ordering + the success-side health/journal gates. The
// failure/rollback orderings live in hermes-update-flow-failures.test.ts.

describe('runOfficialUpdate — success ordering & health gates', () => {
  it('runs preflight → begin → stop → backup → mutate → recover(both) → verify → clear', async () => {
    const { deps, calls } = makeDeps()
    const result = await runOfficialUpdate(deps)
    expect(result).toMatchObject({
      ok: true,
      completed: true,
      version: '0.19.1',
      backupPath: '/backups/pre-update.zip'
    })
    expect(calls).toEqual([
      'methodGate',
      'releaseReachable',
      'targetPreflight',
      'anchor',
      'version:0.19.1', // current version captured for the journal, pre-mutation
      'journal:begin',
      'journal:stopping',
      'stop',
      'run:gateway stop --all',
      'journal:backup',
      'backup',
      'journal:mutating',
      'run:update --yes',
      'journal:recovering',
      'ensureGw',
      'start',
      'health',
      // TWO deep probes, and both are load-bearing. The first is the bounded
      // settle wait's readiness probe: stopOfficialSurfaces just stopped the
      // gateway, so ensureGw necessarily started a FRESH one and it needs ~15-16 s
      // to reach state='running'. The second is the unchanged gate whose verdict
      // alone decides success vs the destructive rollback. Same read-only command,
      // and here it passes on the first sample, so the wait costs exactly one probe.
      'deepHealth',
      'deepHealth',
      'journal:verifying',
      'version:0.19.1',
      'regate',
      'journal:clear:completed'
    ])
  })

  it('asserts BOTH foreground health and gateway deep health before clearing the journal', async () => {
    const { deps, calls } = makeDeps()
    await runOfficialUpdate(deps)
    // foreground /api/health, THEN gateway status --deep, THEN the journal clears.
    expect(calls.indexOf('deepHealth')).toBeGreaterThan(calls.indexOf('health'))
    expect(calls.indexOf('journal:clear:completed')).toBeGreaterThan(calls.indexOf('deepHealth'))
  })

  it('re-gates the ACTUAL landed version and reports success when it is supported', async () => {
    const { deps, calls } = makeDeps({ postVersion: 'hermes 0.19.2' })
    const result = await runOfficialUpdate(deps)
    expect(result).toMatchObject({ ok: true, completed: true, version: 'hermes 0.19.2' })
    expect(calls.indexOf('regate')).toBeGreaterThan(calls.indexOf('deepHealth'))
    expect(calls.some(c => c.startsWith('rollback:'))).toBe(false)
    expect(calls).toContain('journal:clear:completed')
  })

  it('throws Hermes-not-installed before any work when the binary is missing', async () => {
    const { deps, calls } = makeDeps({ command: null })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('Hermes אינו מותקן')
    expect(calls).toEqual([])
  })

  it('does NOT report a plain success when the post-success journal clear is unverifiable', async () => {
    // The update itself succeeded (healthy + supported version) but the active
    // journal could not be verifiably removed. We must NOT roll back a good
    // install, and we must NOT return { ok: true } while a journal survives —
    // an honest "finalize pending" error is surfaced instead.
    const { deps, calls } = makeDeps({ clearThrowsOn: 'completed' })
    await expect(runOfficialUpdate(deps)).rejects.toThrow(/ניקוי יומן העדכון נכשל/)
    // Reached the success point (regate ran) and attempted the clear...
    expect(calls).toContain('regate')
    expect(calls).toContain('journal:clear:completed')
    // ...but never rolled back a healthy install over a delete failure.
    expect(calls.some(c => c.startsWith('rollback:'))).toBe(false)
  })
})
