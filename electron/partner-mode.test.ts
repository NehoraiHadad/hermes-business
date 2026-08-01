import { describe, expect, it } from 'vitest'
import { applyPersona } from './partner-mode.cjs'

function fakeApi() {
  const puts: Array<Record<string, unknown>> = []
  const api = async (endpoint: string, init?: { method?: string; body?: { config?: Record<string, unknown> } }) => {
    if (init?.method === 'PUT') {
      puts.push(init.body?.config || {})
      return { ok: true }
    }
    return {}
  }
  return { api, puts }
}

describe('applyPersona', () => {
  it('installs the named personality and selects it, touching nothing else', async () => {
    const { api, puts } = fakeApi()
    await applyPersona(api)
    expect(puts).toHaveLength(1)
    // Hermes 0.19.x reads personalities from agent.personalities (NOT top-level),
    // and the value must be a non-empty prompt string.
    expect(puts[0]).toHaveProperty('agent.personalities.business-partner')
    expect(puts[0]).not.toHaveProperty('personalities')
    const persona = (puts[0].agent as { personalities: Record<string, unknown> }).personalities['business-partner']
    expect(typeof persona).toBe('string')
    expect((persona as string).length).toBeGreaterThan(0)
    expect(puts[0].display).toEqual({ personality: 'business-partner' })
    // The safe approval/delegation/terminal posture and all backup/restore are
    // owned by sandbox-config + partner-config, so applyPersona must NOT write them.
    expect(puts[0]).not.toHaveProperty('approvals')
    expect(puts[0]).not.toHaveProperty('delegation')
    expect(puts[0]).not.toHaveProperty('terminal')
  })
})
