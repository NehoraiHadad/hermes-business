// Proof orchestration + teardown for the installed-Hermes shared-state E2E.
// Split out of scripts/e2e-hermes-shared-state.mjs so the entry script stays a
// thin sequencer (boot -> health -> session -> collect report). Every probe here
// exercises real Hermes code against ONE isolated HERMES_HOME.

import { rmSync } from 'node:fs'
import { uninstallBusinessShellBackend } from './probes/hermes/plugin-install.mjs'
import {
  proveCronSharedState,
  provePausedCronCrossDoor,
  proveSkillSharedState,
  proveSessionSharedState,
  provePathEvidence
} from './probes/hermes/shared-state.mjs'
import { proveLiveTransport } from './probes/hermes/live-provider.mjs'
import { provePluginSharedState } from './probes/hermes/plugin-shared-state.mjs'

// Teardown: remove any stray cron jobs we created, uninstall the companion
// backend, stop the server, and discard the throwaway home. Best-effort — the
// isolated home is deleted wholesale regardless, so the live profile is never
// touched.
export function makeCleanup({ harness, rpc, hermesHome, ctx }) {
  return async function cleanup() {
    const strays = [ctx.cronCreated && ctx.jobName, ctx.pausedCreated && ctx.pausedJobName].filter(Boolean)
    for (const strayName of strays) {
      try {
        const cron = await rpc('cron.manage', { action: 'list' }, 15_000)
        const job = cron.jobs?.find(j => j.name === strayName)
        if (job) await rpc('cron.manage', { action: 'remove', name: job.id || job.name }, 15_000)
      } catch { /* best effort */ }
    }
    try {
      uninstallBusinessShellBackend(hermesHome)
    } catch { /* best effort; the isolated home is discarded next anyway */ }
    harness.shutdown()
    try {
      rmSync(hermesHome, { recursive: true, force: true })
    } catch { /* temp dir removed on next boot regardless */ }
  }
}

// Run every shared-state probe against the live isolated gateway and assemble
// the acceptance report object (the caller stringifies it with safeJson).
export async function collectSharedStateReport(input) {
  const { harness, rest, home, ctx, storedSessionId, pluginInstall, backendInstall } = input
  const { health, providerReady, installRoot, liveHome, runLlm, stamp, sessionTitle } = input

  const sessionShared = await proveSessionSharedState(harness, rest, storedSessionId)
  const cronShared = await proveCronSharedState(harness, rest, home, ctx)
  const pausedCronCrossDoor = await provePausedCronCrossDoor(harness, rest, home, ctx)
  const skillShared = await proveSkillSharedState(harness, rest, home, ctx)
  const pathEvidence = provePathEvidence(home)
  const pluginShared = await provePluginSharedState({
    harness,
    home,
    storedSessionId,
    install: pluginInstall,
    backendInstall,
    rest
  })

  // Streaming + stop/cancel + tool events require a model. Prove them with the
  // live provider when one is present; otherwise mark honestly as not proven.
  const liveTransport = runLlm
    ? await proveLiveTransport(harness, {
        expected: `HERMES_POC_STREAM_OK_${stamp}`,
        sessionTitle: `${sessionTitle} (transport)`
      })
    : { skipped: true, reason: providerReady ? 'HERMES_E2E_NO_LLM=1' : 'no provider configured in isolated home' }

  return {
    ok: true,
    one_runtime: { install_root: installRoot, isolated_home: home, live_home_untouched: liveHome },
    health: health.status || health.ok || 'healthy',
    provider_ready: providerReady,
    provider_note: providerReady ? 'live provider configured in isolated home' : 'provider-free: no model called',
    session_shared_state: { stored_session_id: storedSessionId, visible_via_rpc_list: true, ...sessionShared },
    cron_shared_state: cronShared,
    paused_cron_cross_door: pausedCronCrossDoor,
    skill_shared_state: skillShared,
    path_evidence: pathEvidence,
    plugin_shared_state: pluginShared,
    live_transport: liveTransport,
    approval_mapping: {
      official_method: 'approval.respond',
      wrapper_delegates_via: 'src/lib/hermes/session.ts respondApproval -> approval.respond',
      competing_engine: false
    }
  }
}
