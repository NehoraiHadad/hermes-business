import { describe, expect, it } from 'vitest'
import { runOfficialUpdate } from './hermes-update-flow.cjs'
import { assertRunningVersionSupported } from './hermes-compat.cjs'

const COMMAND = '/home/hermes-agent/venv/bin/hermes'
const ANCHOR = 'abcdef123456'

type Overrides = {
  command?: string | null
  methodThrows?: boolean
  targetThrows?: boolean
  backupThrows?: boolean
  updateYesThrows?: boolean
  postVersion?: string | null
  anchor?: string | null
  startResult?: { running: boolean; error?: string }
  rollbackResult?: { restored: boolean; method: string; commit?: string; message?: string }
}

function makeDeps(overrides: Overrides = {}) {
  const calls: string[] = []
  const deps = {
    // POSIX so stopOfficialSurfaces skips the Windows-only PowerShell branch.
    platform: 'linux',
    findHermes: () => (overrides.command === undefined ? COMMAND : overrides.command),
    getHermesVersion: () => {
      const v = overrides.postVersion === undefined ? '0.19.1' : overrides.postVersion
      calls.push(`version:${v}`)
      return v
    },
    rememberLog: (m: string) => calls.push(`log:${String(m).slice(0, 24)}`),
    runCaptured: async (_cmd: string, args: string[]) => {
      const tag = args.join(' ')
      calls.push(`run:${tag}`)
      if (tag === 'update --yes' && overrides.updateYesThrows) throw new Error('update --yes failed')
      return { stdout: '', stderr: '' }
    },
    stopHermes: async () => {
      calls.push('stop')
    },
    startHermes: async () => {
      calls.push('start')
      return overrides.startResult ?? { running: true }
    },
    hermesApi: async () => {
      calls.push('health')
      return { ok: true }
    },
    ensureGatewayBackground: async () => {
      calls.push('ensureGw')
    },
    assertUpdateMethodSupported: () => {
      calls.push('methodGate')
      if (overrides.methodThrows) throw new Error('unsupported install method')
      return 'git'
    },
    assertUpdateTargetSupported: () => {
      calls.push('targetPreflight')
      if (overrides.targetThrows) throw new Error('target out of range')
    },
    // Real post-update re-gate: exercises hermes-compat.json enforcement against
    // the version getHermesVersion() reports, end-to-end through the flow.
    assertRunningVersionSupported: (v: string | null) => {
      calls.push('regate')
      return assertRunningVersionSupported(v)
    },
    createPreUpdateBackup: async () => {
      calls.push('backup')
      if (overrides.backupThrows) throw new Error('backup verification failed')
      return '/backups/pre-update.zip'
    },
    captureRollbackAnchor: () => {
      calls.push('anchor')
      return { gitInstall: true, anchor: overrides.anchor === undefined ? ANCHOR : overrides.anchor }
    },
    rollbackAfterFailedUpdate: (arg: { anchor: string | null }) => {
      calls.push(`rollback:${arg.anchor}`)
      return overrides.rollbackResult ?? { restored: true, method: 'git', commit: ANCHOR }
    }
  }
  return { deps, calls }
}

describe('runOfficialUpdate — ordering & failure recovery', () => {
  it('runs preflight → capture → stop → backup → mutate → recover on success', async () => {
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
      'run:update --check',
      'targetPreflight',
      'anchor',
      'stop',
      'run:gateway stop --all',
      'backup',
      'run:update --yes',
      'ensureGw',
      'start',
      'health',
      'version:0.19.1',
      'regate'
    ])
  })

  it('re-gates the ACTUAL landed version and reports success when it is supported', async () => {
    const { deps, calls } = makeDeps({ postVersion: 'hermes 0.19.2' })
    const result = await runOfficialUpdate(deps)
    expect(result).toMatchObject({ ok: true, completed: true, version: 'hermes 0.19.2' })
    // The re-gate runs only after the runtime is healthy again.
    expect(calls.indexOf('regate')).toBeGreaterThan(calls.indexOf('health'))
    expect(calls.some(c => c.startsWith('rollback:'))).toBe(false)
  })

  it('fails closed and rolls back when the update lands an UNSUPPORTED version', async () => {
    const { deps, calls } = makeDeps({ postVersion: '0.20.0' })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('שוחזרה לגרסה הקודמת')
    expect(calls).toContain('run:update --yes')
    expect(calls).toContain('regate')
    expect(calls).toContain(`rollback:${ANCHOR}`)
    // Rollback + recovery happen after the failed re-gate, and never report ok.
    expect(calls.lastIndexOf('start')).toBeGreaterThan(calls.indexOf('regate'))
  })

  it('fails closed and rolls back when the post-update version is UNRESOLVABLE', async () => {
    const { deps, calls } = makeDeps({ postVersion: null })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('שוחזרה לגרסה הקודמת')
    expect(calls).toContain('run:update --yes')
    expect(calls).toContain('regate')
    expect(calls).toContain(`rollback:${ANCHOR}`)
  })

  it('throws Hermes-not-installed before any work when the binary is missing', async () => {
    const { deps, calls } = makeDeps({ command: null })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('Hermes אינו מותקן')
    expect(calls).toEqual([])
  })

  it('gates an unsupported install method BEFORE stopping or backing up', async () => {
    const { deps, calls } = makeDeps({ methodThrows: true })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('unsupported install method')
    expect(calls).not.toContain('stop')
    expect(calls).not.toContain('backup')
    expect(calls).not.toContain('run:update --yes')
    // No mutation → nothing to roll back.
    expect(calls.some(c => c.startsWith('rollback:'))).toBe(false)
  })

  it('aborts on the compat target preflight before stopping the runtime', async () => {
    const { deps, calls } = makeDeps({ targetThrows: true })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('target out of range')
    expect(calls).toContain('methodGate')
    expect(calls).toContain('targetPreflight')
    expect(calls).not.toContain('stop')
    expect(calls).not.toContain('backup')
  })

  it('aborts when the backup fails verification, without ever running update --yes', async () => {
    const { deps, calls } = makeDeps({ backupThrows: true })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('backup verification failed')
    expect(calls).toContain('stop')
    expect(calls).toContain('backup')
    expect(calls).not.toContain('run:update --yes')
    // Backup failed before mutation → no rollback, but the runtime is recovered.
    expect(calls.some(c => c.startsWith('rollback:'))).toBe(false)
    expect(calls).toContain('start')
  })

  it('rolls back to the anchor and recovers when update --yes fails after mutation', async () => {
    const { deps, calls } = makeDeps({ updateYesThrows: true })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('שוחזרה לגרסה הקודמת')
    expect(calls).toContain('run:update --yes')
    expect(calls).toContain(`rollback:${ANCHOR}`)
    // Recovery still runs after the rollback.
    expect(calls.lastIndexOf('start')).toBeGreaterThan(calls.indexOf(`rollback:${ANCHOR}`))
  })

  it('fails closed with the manual-support message when a post-mutation rollback cannot restore', async () => {
    const { deps } = makeDeps({
      updateYesThrows: true,
      rollbackResult: {
        restored: false,
        method: 'non-git',
        message: 'FAILCLOSED: backup at /backups/pre-update.zip — contact support'
      }
    })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('FAILCLOSED')
  })

  it('treats a failed post-update health check as a post-mutation failure and rolls back', async () => {
    // update --yes succeeds, but the runtime never comes healthy → recover throws.
    const { deps, calls } = makeDeps({ startResult: { running: false, error: 'never healthy' } })
    await expect(runOfficialUpdate(deps)).rejects.toThrow('שוחזרה לגרסה הקודמת')
    expect(calls).toContain('run:update --yes')
    expect(calls).toContain(`rollback:${ANCHOR}`)
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
})
