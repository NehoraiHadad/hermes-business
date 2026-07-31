import { describe, expect, it, vi } from 'vitest'
import { createProviderApi, type ProviderApiFn } from './providers'

describe('Hermes provider API', () => {
  it.each([
    { ok: false, reachable: false, message: 'offline' },
    { ok: false, reachable: true, message: 'rejected' }
  ])('never persists a key when validation fails: $message', async validation => {
    const api = vi.fn(async endpoint => {
      if (endpoint === '/api/providers/validate') return validation
      throw new Error(`unexpected call: ${endpoint}`)
    }) as unknown as ProviderApiFn

    await expect(createProviderApi(api).connectProvider('openai', 'secret')).rejects.toThrow(validation.message)
    expect(api).toHaveBeenCalledTimes(1)
    expect(api).not.toHaveBeenCalledWith('/api/env', expect.anything())
  })

  it('validates, persists, and activates an API-key provider through official routes', async () => {
    const calls: string[] = []
    const api = vi.fn(async endpoint => {
      calls.push(endpoint)
      if (endpoint === '/api/providers/validate') return { ok: true, reachable: true }
      if (endpoint.startsWith('/api/model/recommended-default')) return { model: 'openai/gpt-5' }
      return { ok: true }
    }) as unknown as ProviderApiFn

    await expect(createProviderApi(api).connectProvider('openai', 'secret')).resolves.toEqual({
      ok: true,
      model: 'openai/gpt-5'
    })
    expect(calls).toEqual([
      '/api/providers/validate',
      '/api/env',
      '/api/model/recommended-default?provider=openai',
      '/api/model/set'
    ])
  })

  it('uses the official device-code OAuth session routes', async () => {
    const api = vi.fn(async endpoint => {
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

    expect(api).toHaveBeenCalledWith(
      '/api/providers/oauth/sessions/session-1?profile=default',
      { method: 'DELETE' }
    )
  })

  it('does not report activation success when Hermes has no compatible model', async () => {
    const api = vi.fn(async endpoint => {
      if (endpoint.startsWith('/api/model/recommended-default')) return { model: '' }
      return { ok: true }
    }) as unknown as ProviderApiFn

    await expect(createProviderApi(api).activateProvider('openai-codex')).rejects.toThrow(
      'compatible default model'
    )
    expect(api).not.toHaveBeenCalledWith('/api/model/set', expect.anything())
  })
})
