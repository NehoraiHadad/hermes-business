// Streaming + resume probe: creates the shared session, streams a marker reply
// over the gateway and confirms the transcript survives a session.resume.

/**
 * @returns `{ runtimeSessionId, storedSessionId, resumed, deltas }`.
 */
export async function runStreaming(harness, ctx) {
  const { rpc, waitForEvent, events, stage } = harness
  const { expected, sessionTitle } = ctx

  const created = await rpc('session.create', { title: sessionTitle, source: 'desktop', cols: 96 })
  const runtimeSessionId = created.session_id
  const storedSessionId = created.stored_session_id
  await rpc('session.title', { session_id: runtimeSessionId, title: sessionTitle })
  stage(`created shared session ${storedSessionId}`)

  const complete = waitForEvent(
    event => event.type === 'message.complete' && event.session_id === runtimeSessionId
  )
  await rpc('prompt.submit', {
    session_id: runtimeSessionId,
    text: `Reply with exactly: ${expected}. Do not call tools.`
  })
  const completedEvent = await complete
  stage('received message.complete')

  const deltas = events.filter(
    event => event.type === 'message.delta' && event.session_id === runtimeSessionId
  )
  const streamedText = deltas.map(event => String(event.payload?.text || '')).join('')
  const finalText = String(completedEvent.payload?.text || streamedText)
  if (!deltas.length) throw new Error('No message.delta streaming events were received')
  if (!`${streamedText}\n${finalText}`.includes(expected)) {
    throw new Error(`Unexpected model response: ${finalText || streamedText}`)
  }

  const resumed = await rpc('session.resume', { session_id: storedSessionId, cols: 96 })
  if (!resumed?.session_id) throw new Error('session.resume returned no live session id')
  if (!JSON.stringify(resumed.messages || []).includes(expected)) {
    throw new Error('session.resume did not return the persisted streamed response')
  }
  stage('resumed the same persisted session with its transcript')

  return { runtimeSessionId, storedSessionId, resumed, deltas }
}
