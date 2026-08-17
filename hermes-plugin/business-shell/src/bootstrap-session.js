import { host } from '@hermes/plugin-sdk'

// Resolve the installed Skill through Hermes before submitting the expanded
// model-facing message. A literal slash prompt bypasses this official path.
//
// The Skill name is an explicit argument because the two plugin entry points open
// different conversations: the guided first run does not know yet whether the user
// wants tachles for a business or for a community (tachles-welcome), while the
// fallback questionnaire has already collected business answers (business-bootstrap).
export async function submitFirstRunSkill(sessionId, arg, name) {
  const dispatch = await host.request('command.dispatch', {
    session_id: sessionId,
    name,
    arg
  })
  if (dispatch?.type !== 'skill' || dispatch?.name !== name) {
    throw new Error(`Hermes did not resolve /${name} as the requested Skill.`)
  }
  if (typeof dispatch.message !== 'string' || !dispatch.message.trim()) {
    throw new Error(`Hermes resolved /${name}, but returned no Skill message.`)
  }
  await host.request('prompt.submit', { session_id: sessionId, text: dispatch.message })
}
