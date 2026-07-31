import { describe, expect, it } from 'vitest'
import { disablePersonality, enablePersonality } from './partner-mode.cjs'

function fakeApi(config: Record<string, unknown>) {
  const puts: Array<Record<string, unknown>> = []
  const api = async (endpoint: string, init?: { method?: string; body?: { config?: Record<string, unknown> } }) => {
    if (init?.method === 'PUT') {
      puts.push(init.body?.config || {})
      return { ok: true }
    }
    return config
  }
  return { api, puts }
}

describe('enablePersonality', () => {
  it('captures the exact previous display.personality and installs the named personality', async () => {
    const { api, puts } = fakeApi({ display: { personality: 'friendly' } })
    const result = await enablePersonality(null, api)
    expect(result.backup).toEqual({ display: 'friendly' })
    expect(puts[0].display).toEqual({ personality: 'business-partner' })
    // Hermes 0.19.1 reads personalities from agent.personalities (NOT top-level),
    // and the value must be a non-empty prompt string (system_prompt when a dict).
    expect(puts[0]).toHaveProperty('agent.personalities.business-partner')
    expect(puts[0]).not.toHaveProperty('personalities')
    const persona = (puts[0].agent as { personalities: Record<string, unknown> }).personalities[
      'business-partner'
    ]
    expect(typeof persona).toBe('string')
    expect((persona as string).length).toBeGreaterThan(0)
    expect(puts[0].approvals).toEqual({ mode: 'manual', cron_mode: 'deny' })
    expect(puts[0].delegation).toEqual({ subagent_auto_approve: false })
  })

  it('captures null when there was no previous personality', async () => {
    const { api } = fakeApi({ display: {} })
    const result = await enablePersonality(null, api)
    expect(result.backup).toEqual({ display: null })
  })

  it('is idempotent: keeps the real backup when partner is already active', async () => {
    const { api } = fakeApi({ display: { personality: 'business-partner' } })
    const previous = { display: 'friendly' }
    const result = await enablePersonality(previous, api)
    // Must NOT recapture our own injected value as the "previous" one.
    expect(result.backup).toBe(previous)
  })
})

describe('disablePersonality', () => {
  it('restores the exact previous personality string', async () => {
    const { api, puts } = fakeApi({})
    const result = await disablePersonality({ display: 'friendly' }, api)
    expect(result.restored).toBe('friendly')
    expect(puts[0].display).toEqual({ personality: 'friendly' })
  })

  it('restores null (Hermes default) when nothing was captured', async () => {
    const { api, puts } = fakeApi({})
    await disablePersonality(null, api)
    expect(puts[0].display).toEqual({ personality: null })
  })
})
