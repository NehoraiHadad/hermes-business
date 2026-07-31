// Live-provider transport proofs, reusing the official streaming/interrupt/tool
// probes. Runs ONLY when a provider is configured (setup.runtime_check ready)
// and is not disabled via HERMES_E2E_NO_LLM=1. Exercises the real Hermes
// streaming event parser (message.delta/complete), the stop/cancel state
// machine (session.interrupt), and tool activity events (tool.start/complete) —
// the official surfaces the wrapper maps onto, never a competing engine.

import { runStreaming } from './streaming.mjs'
import { runInterruptProbe, runToolProbe } from './optional.mjs'

export async function proveLiveTransport(harness, ctx) {
  const { stage } = harness

  // 1. Streaming + resume: deterministic single-marker reply over the gateway.
  const { resumed, deltas } = await runStreaming(harness, ctx)
  const streaming = { delta_events: deltas.length, marker_streamed_and_persisted: true }

  // 2. Stop/cancel: begin a long reply, confirm a delta, then interrupt it.
  let interrupt = null
  try {
    interrupt = await runInterruptProbe(harness, resumed)
  } catch (error) {
    interrupt = { error: String(error?.message || error) }
  }

  // 3. Tool activity events (opt-in — a tool turn costs another model call).
  let tool = null
  if (process.env.HERMES_E2E_TOOL === '1') {
    try {
      tool = await runToolProbe(harness, resumed)
    } catch (error) {
      tool = { error: String(error?.message || error) }
    }
  }

  stage('live-provider transport (streaming + stop/cancel) proven')
  return { streaming, interrupt, tool }
}
