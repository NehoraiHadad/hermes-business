import { assertRunningVersionSupported } from './hermes-compat.cjs'

// Shared DI harness for the update-flow behavioural tests. Split out of the
// (previously 274-line) single test file so the happy-path/ordering suite and
// the failure/rollback suite can each stay focused. `calls` records the exact
// side-effect order so tests assert ordering without a live Hermes.

export const COMMAND = '/home/hermes-agent/venv/bin/hermes'
export const ANCHOR = 'abcdef123456'

export type Overrides = {
  command?: string | null
  // Simulated milliseconds (on the fixture's FAKE clock) after which the freshly
  // restarted gateway starts reporting deep-healthy. Models the ~15-16 s settle
  // measured live. `undefined` = settled from the first probe.
  gatewaySettlesAtMs?: number
  // Per-test budget for the bounded settle wait inside recoverRuntime. 0
  // reproduces the pre-wait behaviour (a single immediate sample).
  settleDeadlineMs?: number
  // Make the POST-ROLLBACK stopOfficialSurfaces fail (the pre-mutation one still
  // succeeds), to pin that an unprovable restore is never reported as recovered.
  postRollbackStopThrows?: boolean
  // Make the POST-ROLLBACK `gateway stop --all` fail SILENTLY: it does not throw
  // (stopOfficialSurfaces swallows it by design) and the gateway keeps running.
  postRollbackGatewayStopSilentlyFails?: boolean
  // Force the authoritative post-stop gateway reader's verdict. Left unset it is
  // derived truthfully from the model.
  gatewayStateAfterStop?: 'running' | 'stopped' | 'unknown'
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

// A FAKE CLOCK, not a real one: `sleep` never sleeps, it only advances `now`.
// Injected into EVERY flow fixture so the bounded settle wait inside
// recoverRuntime runs its real loop at full speed and no test ever waits.
function makeClock() {
  let t = 1_000_000
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms
    },
    elapsed: () => t - 1_000_000
  }
}

// WHAT THE CHECKOUT HOLDS vs WHAT THE PROCESSES ARE RUNNING.
//
// The two drift apart, and that drift is the whole point of the post-rollback
// stop: `update --yes` rewrites the CHECKOUT, a rollback rewrites it back, but
// neither touches a RUNNING process. So the fixture models them separately and
// records, on every health probe, which code that probe actually proved. A test
// can then assert the restore was verified against the RESTORED version rather
// than the reverted one — instead of merely asserting that a stop was called.
export const PRE_UPDATE_CODE = 'code@pre-update'
export const POST_UPDATE_CODE = 'code@post-update'

export function makeDeps(overrides: Overrides = {}) {
  const calls: string[] = []
  // Which code each health probe actually covered, in order. `null` = the probe
  // ran while nothing was running (which the real health checks would fail).
  const proofs: string[] = []
  const clock = makeClock()
  let checkout = PRE_UPDATE_CODE
  let runningServe: string | null = PRE_UPDATE_CODE
  let runningGateway: string | null = PRE_UPDATE_CODE
  let rolledBack = false
  const deps = {
    // The settle wait's clock/sleep. `awaitGatewayHealth` is deliberately NOT
    // faked: these tests exercise the REAL shared waitForGatewayDeepHealth, only
    // with a fake probe and a fake clock.
    sleep: clock.sleep,
    now: clock.now,
    ...(overrides.settleDeadlineMs === undefined ? {} : { settleDeadlineMs: overrides.settleDeadlineMs }),
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
      // `update --yes` rewrites the CHECKOUT only — a gateway/serve already
      // running keeps executing the old code until something restarts it.
      if (tag === 'update --yes') checkout = POST_UPDATE_CODE
      if (tag === 'gateway stop --all' && !(rolledBack && overrides.postRollbackGatewayStopSilentlyFails)) {
        runningGateway = null
      }
      return { stdout: '', stderr: '' }
    },
    stopHermes: async () => {
      calls.push('stop')
      if (rolledBack && overrides.postRollbackStopThrows) throw new Error('could not stop the runtime')
      runningServe = null
    },
    startHermes: async () => {
      calls.push('start')
      const result = overrides.startResult ?? { running: true }
      // Models the real `if (state.running) return state`: an already-running
      // process is NOT replaced, so it keeps whatever code it started with.
      if (result.running && runningServe === null) runningServe = checkout
      return result
    },
    hermesApi: async () => {
      calls.push('health')
      proofs.push(`serve:${runningServe}`)
      return { ok: true }
    },
    assertGatewayDeepHealthy: async () => {
      calls.push('deepHealth')
      proofs.push(`gateway:${runningGateway}`)
      if (overrides.deepThrows) throw new Error('gateway deep probe failed')
      // A gateway that is still coming up: the SAME assertion the settle wait
      // polls and the gate later makes, failing until the gateway has settled.
      if (overrides.gatewaySettlesAtMs !== undefined && clock.elapsed() < overrides.gatewaySettlesAtMs) {
        throw new Error('deep liveness probe(s) [5] reported FAIL')
      }
    },
    ensureGatewayBackground: async () => {
      calls.push('ensureGw')
      // Models the real "already running -> do NOT restart" branch: only a
      // STOPPED gateway is started, and it then runs whatever the checkout holds.
      if (runningGateway === null) runningGateway = checkout
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
    // Authoritative post-stop liveness reader. Derived from the model so the happy
    // path reports a real `stopped` and a silently-failed stop reports a real
    // `running`; the override exists for the `unknown` (could-not-look) verdict.
    gatewayState: () => {
      calls.push('gatewayState')
      const state = overrides.gatewayStateAfterStop ?? (runningGateway === null ? 'stopped' : 'running')
      return { state }
    },
    rollbackAfterFailedUpdate: (arg: { anchor: string | null }) => {
      calls.push(`rollback:${arg.anchor}`)
      const result = overrides.rollbackResult ?? { restored: true, method: 'git', commit: ANCHOR }
      // `git reset` rewrites the CHECKOUT and stops NOTHING — the running
      // processes keep executing the reverted code until they are restarted.
      if (result.restored) {
        checkout = PRE_UPDATE_CODE
        rolledBack = true
      }
      return result
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
  return { deps, calls, clock, proofs, runningCode: () => ({ serve: runningServe, gateway: runningGateway, checkout }) }
}
