import { host } from '@hermes/plugin-sdk'
import { BOOTSTRAP_COMMAND } from '../../../shared/onboarding-bootstrap.js'

// Resolve the installed Skill through Hermes before submitting the expanded
// model-facing message. A literal slash prompt bypasses this official path.
export async function submitBusinessBootstrap(sessionId, arg) {
  const dispatch = await host.request('command.dispatch', {
    session_id: sessionId,
    name: BOOTSTRAP_COMMAND,
    arg
  })
  if (dispatch?.type !== 'skill' || dispatch?.name !== BOOTSTRAP_COMMAND) {
    throw new Error(`Hermes did not resolve /${BOOTSTRAP_COMMAND} as the requested Skill.`)
  }
  if (typeof dispatch.message !== 'string' || !dispatch.message.trim()) {
    throw new Error(`Hermes resolved /${BOOTSTRAP_COMMAND}, but returned no Skill message.`)
  }
  await host.request('prompt.submit', { session_id: sessionId, text: dispatch.message })
}
