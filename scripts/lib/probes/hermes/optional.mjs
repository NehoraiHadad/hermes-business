// Opt-in live probes: tool events, in-flight interrupt and clarify round-trip.
// Each is gated by its own env flag in the orchestrator and returns null when
// disabled, matching the original report shape.

/** HERMES_E2E_TOOL=1: assert paired tool.start / tool.complete events. */
export async function runToolProbe(harness, resumed) {
  const { rpc, waitForEvent, events, stage } = harness
  const cursor = events.length
  const toolStarted = waitForEvent(
    event => event.type === 'tool.start' && event.session_id === resumed.session_id,
    180_000,
    cursor
  )
  const toolCompleted = waitForEvent(
    event => event.type === 'tool.complete' && event.session_id === resumed.session_id,
    180_000,
    cursor
  )
  const toolTurnComplete = waitForEvent(
    event => event.type === 'message.complete' && event.session_id === resumed.session_id,
    180_000,
    cursor
  )
  await rpc('prompt.submit', {
    session_id: resumed.session_id,
    text:
      'Contract test: use the todo tool exactly once to record a completed item named HERMES_TOOL_EVENT_OK, then reply exactly HERMES_TOOL_EVENT_OK.'
  })
  const [startedEvent, completedToolEvent] = await Promise.all([toolStarted, toolCompleted])
  await toolTurnComplete
  stage('received tool.start and tool.complete')
  return {
    start_received: true,
    complete_received: true,
    same_tool_id:
      Boolean(startedEvent.payload?.tool_id) &&
      startedEvent.payload?.tool_id === completedToolEvent.payload?.tool_id
  }
}

/** HERMES_E2E_INTERRUPT=1: interrupt an in-flight streamed response. */
export async function runInterruptProbe(harness, resumed) {
  const { rpc, waitForEvent, events, stage } = harness
  const cursor = events.length
  const firstDelta = waitForEvent(
    event => event.type === 'message.delta' && event.session_id === resumed.session_id,
    180_000,
    cursor
  )
  await rpc('prompt.submit', {
    session_id: resumed.session_id,
    text: 'Write 200 separately numbered one-sentence business tips. Begin immediately.'
  })
  await firstDelta
  const interrupted = await rpc('session.interrupt', { session_id: resumed.session_id })
  if (interrupted?.status !== 'interrupted') {
    throw new Error(`session.interrupt was not accepted: ${JSON.stringify(interrupted)}`)
  }
  stage('interrupted an in-flight streamed response')
  return { delta_received_before_stop: true, status: interrupted.status }
}

/** HERMES_E2E_CLARIFY=1: drive one clarify request/response round-trip. */
export async function runClarifyProbe(harness, runtimeSessionId) {
  const { rpc, waitForEvent } = harness
  const requestEvent = waitForEvent(
    event => event.type === 'clarify.request' && event.session_id === runtimeSessionId
  )
  await rpc('prompt.submit', {
    session_id: runtimeSessionId,
    text:
      'Contract test: call the clarify tool now with the single open-ended question "What is the business name?". Do not answer it yourself.'
  })
  const clarifyEvent = await requestEvent
  const requestId = String(clarifyEvent.payload?.request_id || '')
  if (!requestId) throw new Error(`clarify.request has no request_id: ${JSON.stringify(clarifyEvent)}`)
  await rpc('clarify.respond', { request_id: requestId, answer: 'POC Business' })
  const probe = {
    request_id_present: true,
    question: clarifyEvent.payload?.question,
    response_accepted: true
  }
  await rpc('session.interrupt', { session_id: runtimeSessionId })
  return probe
}
