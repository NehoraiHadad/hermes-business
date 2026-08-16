import { describe, expect, it, vi } from 'vitest'
import { createCommunityProviderApi } from './community-provider'

describe('community provider client', () => {
  it('runs OAuth and non-secret model selection exclusively through the community bridge', async () => {
    const communityApi = vi.fn(async (endpoint: string) => {
      if (endpoint === '/api/providers/oauth?profile=default') return { providers: [] }
      if (endpoint.includes('/start?')) {
        return { session_id: 's1', flow: 'device_code', user_code: 'ABCD', verification_url: 'https://example.test', expires_in: 60, poll_interval: 1 }
      }
      if (endpoint.includes('/poll/')) return { session_id: 's1', status: 'approved' }
      if (endpoint.includes('/recommended-default')) return { model: 'openai-codex/gpt-5', free_tier: false }
      if (endpoint === '/api/model/set') return { ok: true }
      throw new Error(`unexpected ${endpoint}`)
    })
    const api = createCommunityProviderApi({ communityApi } as Pick<HermesDesktopBridge, 'communityApi'>)

    await api.listOAuthProviders()
    await api.startOAuth('openai-codex')
    await api.pollOAuth('openai-codex', 's1')
    await expect(api.activateProvider('openai-codex')).resolves.toMatchObject({ model: 'openai-codex/gpt-5' })

    expect(communityApi.mock.calls.map(call => call[0])).toEqual([
      '/api/providers/oauth?profile=default',
      '/api/providers/oauth/openai-codex/start?profile=default',
      '/api/providers/oauth/openai-codex/poll/s1?profile=default',
      '/api/model/recommended-default?provider=openai-codex',
      '/api/model/set'
    ])
  })
})
