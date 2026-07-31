import { PROVIDER_API_KEYS, withProfile, type ApiFn } from './core'

// Retained alias so existing importers keep compiling; the canonical type now
// lives in ./core alongside the other shared function shapes.
export type ProviderApiFn = ApiFn

export type OAuthProvider = {
  id: string
  name: string
  flow: 'pkce' | 'device_code' | 'external'
  docs_url?: string
  status?: { logged_in?: boolean; source_label?: string; error?: string }
}

export type OAuthStart = {
  session_id: string
  flow: 'device_code'
  user_code: string
  verification_url: string
  expires_in: number
  poll_interval: number
}

export type OAuthPoll = {
  session_id: string
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'error'
  error_message?: string | null
}

export interface HermesProviderApi {
  connectProvider(provider: string, apiKey: string): Promise<{ ok: boolean; model: string }>
  listOAuthProviders(): Promise<OAuthProvider[]>
  startOAuth(provider: string): Promise<OAuthStart>
  pollOAuth(provider: string, sessionId: string): Promise<OAuthPoll>
  cancelOAuth(sessionId: string): Promise<{ ok: boolean }>
  activateProvider(provider: string): Promise<{ ok: boolean; model: string }>
}

export function createProviderApi(api: ApiFn): HermesProviderApi {
  const activateProvider = async (provider: string) => {
    const recommended = await api<{ model: string }>(
      `/api/model/recommended-default?provider=${encodeURIComponent(provider)}`
    )
    if (!recommended.model) throw new Error('Hermes did not provide a compatible default model for this provider')
    await api('/api/model/set', {
      method: 'POST',
      body: { scope: 'main', provider, model: recommended.model, confirm_expensive_model: true }
    })
    return { ok: true, model: recommended.model }
  }

  return {
    async connectProvider(provider: string, apiKey: string) {
      const key = PROVIDER_API_KEYS[provider]
      if (!key) throw new Error('Provider is not supported by this quick setup')
      const validation = await api<{ ok: boolean; reachable: boolean; message?: string }>('/api/providers/validate', {
        method: 'POST',
        body: { key, value: apiKey }
      })
      if (!validation.ok) {
        throw new Error(
          validation.message ||
            (validation.reachable ? 'The API key was rejected' : 'Hermes could not reach the provider')
        )
      }
      await api('/api/env', { method: 'PUT', body: { key, value: apiKey } })
      return activateProvider(provider)
    },

    async listOAuthProviders() {
      const result = await api<{ providers?: OAuthProvider[] }>(withProfile('/api/providers/oauth'))
      return result.providers || []
    },

    startOAuth(provider: string) {
      return api<OAuthStart>(withProfile(`/api/providers/oauth/${encodeURIComponent(provider)}/start`), {
        method: 'POST'
      })
    },

    pollOAuth(provider: string, sessionId: string) {
      return api<OAuthPoll>(
        withProfile(
          `/api/providers/oauth/${encodeURIComponent(provider)}/poll/${encodeURIComponent(sessionId)}`
        )
      )
    },

    cancelOAuth(sessionId: string) {
      return api<{ ok: boolean }>(
        withProfile(`/api/providers/oauth/sessions/${encodeURIComponent(sessionId)}`),
        { method: 'DELETE' }
      )
    },

    activateProvider
  }
}
