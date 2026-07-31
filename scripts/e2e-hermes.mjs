// Live-Hermes acceptance test. Orchestrator only: the server/socket/RPC harness
// lives in scripts/lib/hermes-live.mjs, shared primitives in
// scripts/lib/e2e-harness.mjs, and each probe in scripts/lib/probes/hermes/*.
// Behavior, opt-in env flags and the JSON report shape are preserved.

import { randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import { safeJson, sanitize, waitForHealth } from './lib/e2e-harness.mjs'
import { resolveInstalledHermes, createIsolatedHome, offlineChannelEnv, liveHermesHome } from './lib/hermes-shared-home.mjs'
import { createHermesHarness } from './lib/hermes-live.mjs'
import { runStreaming } from './lib/probes/hermes/streaming.mjs'
import { runClarifyProbe, runInterruptProbe, runToolProbe } from './lib/probes/hermes/optional.mjs'
import { countSkills, runCronCycle, verifySharedSession } from './lib/probes/hermes/registry.mjs'

const port = Number(process.env.HERMES_E2E_PORT || 9129)
// Run the installed binary but against a throwaway HERMES_HOME so the user's
// real Hermes profile/state is never mutated (the previous resolveHermesBinary
// default pointed HERMES_HOME at the live profile — a safety gap).
const { hermes } = resolveInstalledHermes()
const hermesHome = createIsolatedHome()
const token = randomBytes(32).toString('base64url')
const baseUrl = `http://127.0.0.1:${port}`
const wsUrl = `ws://127.0.0.1:${port}/api/ws?token=${encodeURIComponent(token)}`

const ctx = {
  jobName: `POC E2E ${new Date().toISOString().replace(/[:.]/g, '-')}`,
  expected: `HERMES_POC_STREAM_OK_${Date.now()}`,
  sessionTitle: `POC E2E — shared session ${Date.now()}`,
  runClarifyProbe: process.env.HERMES_E2E_CLARIFY === '1',
  runInterruptProbe: process.env.HERMES_E2E_INTERRUPT === '1',
  runToolProbe: process.env.HERMES_E2E_TOOL === '1',
  cronCreated: false
}

const harness = createHermesHarness({ hermes, hermesHome, port, token, wsUrl, extraEnv: offlineChannelEnv() })
const { rpc, stage } = harness

try {
  stage(`isolated HERMES_HOME: ${hermesHome} (live home untouched: ${liveHermesHome()})`)
  stage(`starting Hermes on 127.0.0.1:${port}`)
  harness.startServer()

  const health = await waitForHealth(baseUrl, token)
  stage('health endpoint is ready')

  await harness.connectSocket()
  stage('WebSocket is connected')

  const readiness = await rpc('setup.runtime_check', {})
  if (!readiness?.ok && !readiness?.ready) {
    throw new Error(`Runtime is not ready: ${JSON.stringify(readiness)}`)
  }
  stage(`runtime is ready (${readiness.provider || 'provider configured'})`)

  const { runtimeSessionId, storedSessionId, resumed, deltas } = await runStreaming(harness, ctx)

  const toolProbe = ctx.runToolProbe ? await runToolProbe(harness, resumed) : null
  const interruptProbe = ctx.runInterruptProbe ? await runInterruptProbe(harness, resumed) : null
  const clarifyProbe = ctx.runClarifyProbe ? await runClarifyProbe(harness, runtimeSessionId) : null

  const sharedSession = await verifySharedSession(harness, storedSessionId)
  const skillCount = await countSkills(harness)
  await runCronCycle(harness, ctx)

  console.log(
    safeJson({
      ok: true,
      health: health.status || health.ok || 'healthy',
      provider: readiness.provider || 'configured',
      model: readiness.model || 'configured',
      streaming: { delta_events: deltas.length, expected_marker_received: true },
      resume: { transcript_restored: true },
      tool_events: toolProbe,
      interrupt: interruptProbe,
      clarify: clarifyProbe,
      shared_session: {
        stored_session_id: storedSessionId,
        title: sharedSession.title,
        source: sharedSession.source
      },
      skills: { discovered: skillCount },
      cron: { create_pause_resume_remove: true }
    })
  )
} catch (error) {
  console.error(sanitize(error instanceof Error ? error.stack : String(error)))
  if (harness.serverOutput.length) {
    console.error(harness.serverOutput.slice(-20).join('').slice(-5000))
  }
  process.exitCode = 1
} finally {
  if (ctx.cronCreated && harness.socket?.readyState === WebSocket.OPEN) {
    try {
      const cron = await rpc('cron.manage', { action: 'list' }, 15_000)
      const job = cron.jobs?.find(item => item.name === ctx.jobName)
      if (job) await rpc('cron.manage', { action: 'remove', name: job.id || job.name }, 15_000)
    } catch {
      // Best-effort cleanup after a failed assertion.
    }
  }
  harness.shutdown()
  try {
    rmSync(hermesHome, { recursive: true, force: true })
  } catch {
    // Temp home under the OS temp dir; safe to leave for the OS to reap.
  }
}
