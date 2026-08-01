import type { HermesCommands } from './command'
import type { HermesSessions } from './session'

type SkillSessionClient = Pick<HermesSessions, 'createSession' | 'submit'> & HermesCommands

type CreatedSession = Awaited<ReturnType<HermesSessions['createSession']>>

export async function startSkillSession(
  client: SkillSessionClient,
  input: {
    name: string
    arg: string
    onCreated?: (session: CreatedSession) => void
  }
): Promise<CreatedSession> {
  const created = await client.createSession()
  input.onCreated?.(created)

  const dispatch = await client.dispatchCommand(created.session_id, input.name, input.arg)
  if (dispatch.type !== 'skill' || dispatch.name !== input.name) {
    throw new Error(`Hermes did not resolve /${input.name} as the requested Skill.`)
  }
  if (typeof dispatch.message !== 'string' || !dispatch.message.trim()) {
    throw new Error(`Hermes resolved /${input.name}, but returned no Skill message.`)
  }

  await client.submit(created.session_id, dispatch.message)
  return created
}
