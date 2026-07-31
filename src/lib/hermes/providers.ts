export type ProviderApiFn = <T>(
  endpoint: string,
  init?: { method?: string; body?: unknown }
) => Promise<T>

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

const API_KEY_NAMES: Record<string, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY'
}

export function createProviderApi(api: ProviderApiFn): HermesProviderApi {
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
      const key = API_KEY_NAMES[provider]
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
      const result = await api<{ providers?: OAuthProvider[] }>('/api/providers/oauth?profile=default')
      return result.providers || []
    },

    startOAuth(provider: string) {
      return api<OAuthStart>(`/api/providers/oauth/${encodeURIComponent(provider)}/start?profile=default`, {
        method: 'POST'
      })
    },

    pollOAuth(provider: string, sessionId: string) {
      return api<OAuthPoll>(
        `/api/providers/oauth/${encodeURIComponent(provider)}/poll/${encodeURIComponent(sessionId)}?profile=default`
      )
    },

    cancelOAuth(sessionId: string) {
      return api<{ ok: boolean }>(
        `/api/providers/oauth/sessions/${encodeURIComponent(sessionId)}?profile=default`,
        { method: 'DELETE' }
      )
    },

    activateProvider
  }
}
