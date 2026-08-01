import { assertRunningVersionSupported } from './hermes-compat.cjs'

// Shared DI harness for the update-flow behavioural tests. Split out of the
// (previously 274-line) single test file so the happy-path/ordering suite and
// the failure/rollback suite can each stay focused. `calls` records the exact
// side-effect order so tests assert ordering without a live Hermes.

export const COMMAND = '/home/hermes-agent/venv/bin/hermes'
export const ANCHOR = 'abcdef123456'

export type Overrides = {
  command?: string | null
  methodThrows?: boolean
  reachableThrows?: boolean
  targetThrows?: boolean
  backupThrows?: boolean
  updateYesThrows?: boolean
  deepThrows?: boolean
  postVersion?: string | null
  anchor?: string | null
  startResult?: { running: boolean; error?: string }
  rollbackResult?: { restored: boolean; method: string; commit?: string; message?: string }
  clearThrowsOn?: string // outcome value on which journal.clearJournal should throw
}

export function makeDeps(overrides: Overrides = {}) {
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
    assertGatewayDeepHealthy: async () => {
      calls.push('deepHealth')
      if (overrides.deepThrows) throw new Error('gateway deep probe failed')
    },
    ensureGatewayBackground: async () => {
      calls.push('ensureGw')
    },
    assertUpdateMethodSupported: () => {
      calls.push('methodGate')
      if (overrides.methodThrows) throw new Error('unsupported install method')
      return 'git'
    },
    assertReleaseReachable: async () => {
      calls.push('releaseReachable')
      if (overrides.reachableThrows) throw new Error('release source unreachable')
    },
    assertUpdateTargetSupported: () => {
      calls.push('targetPreflight')
      if (overrides.targetThrows) throw new Error('target out of range')
      return { checked: true, target: '0.19.2' }
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
    },
    journal: {
      beginUpdate: () => calls.push('journal:begin'),
      updatePhase: (phase: string) => calls.push(`journal:${phase}`),
      recordFailure: () => calls.push('journal:fail'),
      clearJournal: (arg: { outcome: string }) => {
        calls.push(`journal:clear:${arg.outcome}`)
        if (overrides.clearThrowsOn && arg.outcome === overrides.clearThrowsOn) {
          throw new Error('Active update journal still present after clear')
        }
      }
    }
  }
  return { deps, calls }
}
