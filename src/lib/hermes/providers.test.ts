import { describe, expect, it, vi } from 'vitest'
import { createProviderApi, type ProviderApiFn, type ProviderCredentialProbe } from './providers'

// A fake Hermes REST that resolves a default model, validates, and accepts env/model-set.
// `validate` is the /api/providers/validate response under test.
function fakeApi(validate: { ok?: boolean; reachable?: boolean; message?: string }, model = 'openai/gpt-5') {
  const calls: string[] = []
  const api = vi.fn(async (endpoint: string) => {
    calls.push(endpoint)
    if (endpoint.startsWith('/api/model/recommended-default')) return { model }
    if (endpoint === '/api/providers/validate') return validate
    return { ok: true }
  }) as unknown as ProviderApiFn
  return { api, calls }
}

describe('Hermes provider API — connectProvider records live evidence, never accepts an invalid key', () => {
  it.each([
    { ok: false, reachable: false, message: 'offline' },
    { ok: false, reachable: true, message: 'rejected' }
  ])('never persists a key when Hermes validation fails: $message', async validate => {
    const { api } = fakeApi(validate)
    await expect(createProviderApi(api).connectProvider('openai', 'secret')).rejects.toThrow(validate.message)
    expect(api).not.toHaveBeenCalledWith('/api/env', expect.anything())
    expect(api).not.toHaveBeenCalledWith('/api/model/set', expect.anything())
  })

  it('validates, persists, activates AND returns evidence scoped to the exact provider+model', async () => {
    const { api, calls } = fakeApi({ ok: true, reachable: true }, 'openai/gpt-5')
    const result = await createProviderApi(api).connectProvider('openai', 'secret')
    expect(result.ok).toBe(true)
    expect(result.model).toBe('openai/gpt-5')
    expect(result.validation).toMatchObject({
      provider: 'openai',
      model: 'openai/gpt-5',
      ok: true,
      reachable: true,
      method: 'validate'
    })
    expect(typeof result.validation.validatedAt).toBe('string')
    // Model is resolved BEFORE the key is probed (evidence is model-scoped); env/set follow.
    expect(calls).toEqual([
      '/api/model/recommended-default?provider=openai',
      '/api/providers/validate',
      '/api/env',
      '/api/model/set'
    ])
    // Non-secret evidence never carries the key.
    expect(JSON.stringify(result.validation)).not.toContain('secret')
  })

  describe('reachable:false (a provider Hermes cannot probe, e.g. Anthropic)', () => {
    it('FAILS HONESTLY when no out-of-band probe is available — never a blind pass', async () => {
      const { api } = fakeApi({ ok: true, reachable: false }, 'anthropic/claude-opus-4-8')
      await expect(createProviderApi(api).connectProvider('anthropic', 'sk-ant')).rejects.toThrow(/לא ניתן לאמת ספק זה/)
      expect(api).not.toHaveBeenCalledWith('/api/env', expect.anything())
    })

    it('runs the supplemental probe; a REJECTED probe never persists the key', async () => {
      const { api } = fakeApi({ ok: true, reachable: false }, 'anthropic/claude-opus-4-8')
      const probe: ProviderCredentialProbe = vi.fn(async () => ({ ok: false, reachable: true, message: 'key rejected' }))
      await expect(createProviderApi(api, probe).connectProvider('anthropic', 'sk-bad')).rejects.toThrow('key rejected')
      expect(probe).toHaveBeenCalledWith({ provider: 'anthropic', envKey: 'ANTHROPIC_API_KEY', apiKey: 'sk-bad', model: 'anthropic/claude-opus-4-8' })
      expect(api).not.toHaveBeenCalledWith('/api/env', expect.anything())
    })

    it('a probe that could not run (reachable:false) is NOT proof — refuses', async () => {
      const { api } = fakeApi({ ok: true, reachable: false }, 'anthropic/claude-opus-4-8')
      const probe: ProviderCredentialProbe = vi.fn(async () => ({ ok: false, reachable: false }))
      await expect(createProviderApi(api, probe).connectProvider('anthropic', 'sk')).rejects.toThrow()
      expect(api).not.toHaveBeenCalledWith('/api/env', expect.anything())
    })

    it('a PROVEN probe persists the key and records reachable:true evidence for the exact model', async () => {
      const { api } = fakeApi({ ok: true, reachable: false }, 'anthropic/claude-opus-4-8')
      const probe: ProviderCredentialProbe = vi.fn(async () => ({ ok: true, reachable: true }))
      const result = await createProviderApi(api, probe).connectProvider('anthropic', 'sk-good')
      expect(result.model).toBe('anthropic/claude-opus-4-8')
      expect(result.validation).toMatchObject({ provider: 'anthropic', model: 'anthropic/claude-opus-4-8', ok: true, reachable: true })
      expect(api).toHaveBeenCalledWith('/api/env', { method: 'PUT', body: { key: 'ANTHROPIC_API_KEY', value: 'sk-good' } })
    })
  })

  it('does not report activation success when Hermes has no compatible model', async () => {
    const api = vi.fn(async (endpoint: string) => {
      if (endpoint.startsWith('/api/model/recommended-default')) return { model: '' }
      return { ok: true }
    }) as unknown as ProviderApiFn
    await expect(createProviderApi(api).activateProvider('openai-codex')).rejects.toThrow('compatible default model')
    expect(api).not.toHaveBeenCalledWith('/api/model/set', expect.anything())
  })

  it('activateProvider passes Hermes\' free-tier verdict through — and null when Hermes did not say', async () => {
    const withVerdict = vi.fn(async (endpoint: string) => {
      if (endpoint.startsWith('/api/model/recommended-default')) {
        return { provider: 'nous', model: 'Hermes-4-70B', free_tier: true }
      }
      return { ok: true }
    }) as unknown as ProviderApiFn
    await expect(createProviderApi(withVerdict).activateProvider('nous')).resolves.toEqual({
      ok: true,
      model: 'Hermes-4-70B',
      free_tier: true
    })

    const withoutVerdict = vi.fn(async (endpoint: string) => {
      if (endpoint.startsWith('/api/model/recommended-default')) return { model: 'openai/gpt-5' }
      return { ok: true }
    }) as unknown as ProviderApiFn
    await expect(createProviderApi(withoutVerdict).activateProvider('openai-codex')).resolves.toEqual({
      ok: true,
      model: 'openai/gpt-5',
      free_tier: null
    })
  })

  it('uses the official device-code OAuth session routes', async () => {
    const api = vi.fn(async (endpoint: string) => {
      if (endpoint === '/api/providers/oauth?profile=default') {
        return { providers: [{ id: 'openai-codex', name: 'OpenAI Codex', flow: 'device_code' }] }
      }
      if (endpoint.includes('/start')) {
        return {
          session_id: 'session-1',
          flow: 'device_code',
          user_code: 'ABCD-EFGH',
          verification_url: 'https://example.test/device',
          expires_in: 600,
          poll_interval: 1
        }
      }
      if (endpoint.includes('/poll/')) return { session_id: 'session-1', status: 'approved' }
      return { ok: true }
    }) as unknown as ProviderApiFn
    const providers = createProviderApi(api)

    await expect(providers.listOAuthProviders()).resolves.toHaveLength(1)
    await expect(providers.startOAuth('openai-codex')).resolves.toMatchObject({ user_code: 'ABCD-EFGH' })
    await expect(providers.pollOAuth('openai-codex', 'session-1')).resolves.toMatchObject({ status: 'approved' })
    await providers.cancelOAuth('session-1')

    expect(api).toHaveBeenCalledWith('/api/providers/oauth/sessions/session-1?profile=default', { method: 'DELETE' })
  })
})
