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
//
// The probe orchestration + teardown live in ./lib/e2e-shared-state-proofs.mjs;
// this file only sequences boot -> health -> session -> report.

import { randomBytes } from 'node:crypto'
import { resolveInstalledHermes, createIsolatedHome, offlineChannelEnv, liveHermesHome } from './lib/hermes-shared-home.mjs'
import { safeJson, sanitize, waitForHealth } from './lib/e2e-harness.mjs'
import { createHermesHarness } from './lib/hermes-live.mjs'
import { createRestClient } from './lib/hermes-rest.mjs'
import { installBusinessShell, installBusinessShellBackend } from './lib/probes/hermes/plugin-install.mjs'
import { collectSharedStateReport, makeCleanup } from './lib/e2e-shared-state-proofs.mjs'

const port = Number(process.env.HERMES_E2E_PORT || 9131)
const { hermes, installRoot } = resolveInstalledHermes()
const hermesHome = createIsolatedHome()
const token = randomBytes(32).toString('base64url')
const baseUrl = `http://127.0.0.1:${port}`
const wsUrl = `ws://127.0.0.1:${port}/api/ws?token=${encodeURIComponent(token)}`
const stamp = Date.now()

const ctx = {
  jobName: `POC E2E cron ${stamp}`,
  pausedJobName: `POC E2E paused ${stamp}`,
  skillName: `poc-e2e-shared-${stamp}`,
  sessionTitle: `POC E2E shared session ${stamp}`,
  cronCreated: false,
  pausedCreated: false,
  checkinJobId: null,
  skillCreated: false
}

const harness = createHermesHarness({ hermes, hermesHome, port, token, wsUrl, extraEnv: offlineChannelEnv() })
const { rpc, stage } = harness
const rest = createRestClient({ baseUrl, token })
const cleanup = makeCleanup({ harness, rpc, hermesHome, ctx })

try {
  stage(`installed binary: ${installRoot}`)
  stage(`isolated HERMES_HOME: ${hermesHome} (live home left untouched: ${liveHermesHome()})`)

  // Install the real business-shell Desktop plugin via the OFFICIAL disk-door
  // contract BEFORE boot, so the gateway scans its bootstrap Skill at startup.
  const pluginInstall = installBusinessShell(hermesHome)
  stage(`installed business-shell plugin (official disk door): ${pluginInstall.target}`)

  // Install + enable the READ-ONLY companion backend BEFORE boot, so the web
  // server mounts /api/plugins/business-shell/ at startup. This is the
  // paused-inclusive source of truth (list_jobs(include_disabled=True)) the
  // desktop plugin reaches via its namespace-locked ctx.rest.
  const backendInstall = installBusinessShellBackend(hermesHome)
  stage(`installed + enabled business-shell companion backend: ${backendInstall.namespace} (${backendInstall.enabledVia})`)

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

  const report = await collectSharedStateReport({
    harness,
    rest,
    home: hermesHome,
    ctx,
    storedSessionId,
    pluginInstall,
    backendInstall,
    health,
    providerReady,
    installRoot,
    liveHome: liveHermesHome(),
    runLlm: providerReady && process.env.HERMES_E2E_NO_LLM !== '1',
    stamp,
    sessionTitle: ctx.sessionTitle
  })
  console.log(safeJson(report))
} catch (error) {
  console.error(sanitize(error instanceof Error ? error.stack : String(error)))
  if (harness.serverOutput.length) console.error(harness.serverOutput.slice(-20).join('').slice(-4000))
  process.exitCode = 1
} finally {
  await cleanup()
}
