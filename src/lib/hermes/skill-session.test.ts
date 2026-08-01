import { describe, expect, it, vi } from 'vitest'
import { startSkillSession } from './skill-session'

function fakeClient(dispatch: Record<string, unknown>) {
  const order: string[] = []
  return {
    order,
    client: {
      createSession: vi.fn(async () => {
        order.push('session.create')
        return { session_id: 'runtime-1', stored_session_id: 'stored-1' }
      }),
      dispatchCommand: vi.fn(async () => {
        order.push('command.dispatch')
        return dispatch
      }),
      submit: vi.fn(async () => {
        order.push('prompt.submit')
        return { status: 'streaming' }
      })
    }
  }
}

describe('Skill session orchestration', () => {
  it('creates, dispatches, then awaits the expanded message on one runtime session', async () => {
    const { client, order } = fakeClient({ type: 'skill', name: 'business-bootstrap', message: 'expanded skill' })

    await startSkillSession(client, { name: 'business-bootstrap', arg: 'setup facts' })

    expect(order).toEqual(['session.create', 'command.dispatch', 'prompt.submit'])
    expect(client.dispatchCommand).toHaveBeenCalledWith('runtime-1', 'business-bootstrap', 'setup facts')
    expect(client.submit).toHaveBeenCalledWith('runtime-1', 'expanded skill')
    expect(client.submit).not.toHaveBeenCalledWith('runtime-1', expect.stringContaining('/business-bootstrap'))
  })

  it.each([
    [{ type: 'send', message: 'not a skill' }, 'requested Skill'],
    [{ type: 'skill', name: 'business-bootstrap' }, 'no Skill message']
  ])('fails clearly and never submits an invalid dispatch', async (dispatch, message) => {
    const { client } = fakeClient(dispatch)

    await expect(startSkillSession(client, { name: 'business-bootstrap', arg: 'setup facts' })).rejects.toThrow(message)
    expect(client.submit).not.toHaveBeenCalled()
  })
})
