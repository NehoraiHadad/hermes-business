// Installed-Hermes shared-state acceptance. Proves ONE installed runtime and
// ONE isolated HERMES_HOME back BOTH the wrapper contract (REST /api/cron,
// /api/skills + RPC session/prompt) AND the official Hermes surfaces (gateway
// RPC, REST /api/sessions, on-disk profile). Uses the installed binary but a
// throwaway temp home so the user's real Hermes state is never touched.
//
// Provider-free by default: every assertion below exercises real Hermes code
// without a paid model. Streaming/tool/interrupt (which need a model) are
// delegated to the existing probes only when a provider is configured or the
// deterministic local mock is enabled (HERMES_E2E_MOCK_PROVIDER=1).

import { randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import { resolveInstalledHermes, createIsolatedHome, offlineChannelEnv, liveHermesHome } from './lib/hermes-shared-home.mjs'
import { safeJson, sanitize, waitForHealth } from './lib/e2e-harness.mjs'
import { createHermesHarness } from './lib/hermes-live.mjs'
import { createRestClient } from './lib/hermes-rest.mjs'
import {
  proveCronSharedState,
  proveSkillSharedState,
  proveSessionSharedState,
  provePathEvidence
} from './lib/probes/hermes/shared-state.mjs'
import { proveLiveTransport } from './lib/probes/hermes/live-provider.mjs'
import { installBusinessShell } from './lib/probes/hermes/plugin-install.mjs'
import { provePluginSharedState } from './lib/probes/hermes/plugin-shared-state.mjs'

const port = Number(process.env.HERMES_E2E_PORT || 9131)
const { hermes, installRoot } = resolveInstalledHermes()
const hermesHome = createIsolatedHome()
const token = randomBytes(32).toString('base64url')
const baseUrl = `http://127.0.0.1:${port}`
const wsUrl = `ws://127.0.0.1:${port}/api/ws?token=${encodeURIComponent(token)}`
const stamp = Date.now()

const ctx = {
  jobName: `POC E2E cron ${stamp}`,
  skillName: `poc-e2e-shared-${stamp}`,
  sessionTitle: `POC E2E shared session ${stamp}`,
  cronCreated: false,
  skillCreated: false
}

const harness = createHermesHarness({ hermes, hermesHome, port, token, wsUrl, extraEnv: offlineChannelEnv() })
const { rpc, stage } = harness
const rest = createRestClient({ baseUrl, token })

async function cleanup() {
  if (ctx.cronCreated) {
    try {
      const cron = await rpc('cron.manage', { action: 'list' }, 15_000)
      const job = cron.jobs?.find(j => j.name === ctx.jobName)
      if (job) await rpc('cron.manage', { action: 'remove', name: job.id || job.name }, 15_000)
    } catch { /* best effort */ }
  }
  harness.shutdown()
  try {
    rmSync(hermesHome, { recursive: true, force: true })
  } catch { /* temp dir removed on next boot regardless */ }
}

try {
  stage(`installed binary: ${installRoot}`)
  stage(`isolated HERMES_HOME: ${hermesHome} (live home left untouched: ${liveHermesHome()})`)

  // Install the real business-shell Desktop plugin via the OFFICIAL disk-door
  // contract BEFORE boot, so the gateway scans its bootstrap Skill at startup.
  const pluginInstall = installBusinessShell(hermesHome)
  stage(`installed business-shell plugin (official disk door): ${pluginInstall.target}`)

  harness.startServer()

  const health = await waitForHealth(baseUrl, token)
  stage('health endpoint is ready')
  await harness.connectSocket()
  stage('WebSocket gateway is connected')

  let readiness = null
  try {
    readiness = await rpc('setup.runtime_check', {}, 30_000)
  } catch (error) {
    readiness = { ok: false, error: sanitize(String(error?.message || error)) }
  }
  const providerReady = Boolean(readiness?.ok || readiness?.ready)
  stage(`provider readiness: ${providerReady ? readiness.provider || 'ready' : 'no provider (provider-free proof)'}`)

  // Wrapper RPC contract creates a session; official REST + RPC surfaces see it.
  const created = await rpc('session.create', { title: ctx.sessionTitle, source: 'desktop', cols: 96 })
  const storedSessionId = created.stored_session_id
  await rpc('session.title', { session_id: created.session_id, title: ctx.sessionTitle })
  stage(`created shared session ${storedSessionId} via wrapper RPC contract`)

  const listed = await rpc('session.list', { limit: 100 })
  if (!listed.sessions?.some(s => s.id === storedSessionId)) {
    throw new Error('session not visible via official session.list RPC')
  }
  const sessionShared = await proveSessionSharedState(harness, rest, storedSessionId)
  const cronShared = await proveCronSharedState(harness, rest, hermesHome, ctx)
  const skillShared = await proveSkillSharedState(harness, rest, hermesHome, ctx)
  const pathEvidence = provePathEvidence(hermesHome)
  const pluginShared = await provePluginSharedState({
    harness,
    home: hermesHome,
    storedSessionId,
    install: pluginInstall
  })

  // Streaming + stop/cancel + tool events require a model. Prove them with the
  // live provider when one is present; otherwise mark honestly as not proven.
  const runLlm = providerReady && process.env.HERMES_E2E_NO_LLM !== '1'
  const liveTransport = runLlm
    ? await proveLiveTransport(harness, {
        expected: `HERMES_POC_STREAM_OK_${stamp}`,
        sessionTitle: `${ctx.sessionTitle} (transport)`
      })
    : { skipped: true, reason: providerReady ? 'HERMES_E2E_NO_LLM=1' : 'no provider configured in isolated home' }

  console.log(
    safeJson({
      ok: true,
      one_runtime: { install_root: installRoot, isolated_home: hermesHome, live_home_untouched: liveHermesHome() },
      health: health.status || health.ok || 'healthy',
      provider_ready: providerReady,
      provider_note: providerReady ? 'live provider configured in isolated home' : 'provider-free: no model called',
      session_shared_state: { stored_session_id: storedSessionId, visible_via_rpc_list: true, ...sessionShared },
      cron_shared_state: cronShared,
      skill_shared_state: skillShared,
      path_evidence: pathEvidence,
      plugin_shared_state: pluginShared,
      live_transport: liveTransport,
      approval_mapping: {
        official_method: 'approval.respond',
        wrapper_delegates_via: 'src/lib/hermes/session.ts respondApproval -> approval.respond',
        competing_engine: false
      }
    })
  )
} catch (error) {
  console.error(sanitize(error instanceof Error ? error.stack : String(error)))
  if (harness.serverOutput.length) console.error(harness.serverOutput.slice(-20).join('').slice(-4000))
  process.exitCode = 1
} finally {
  await cleanup()
}
