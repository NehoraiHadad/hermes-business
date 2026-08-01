import { PROVIDER_API_KEYS, withProfile, type ApiFn } from './core'
import { recordValidation, type ProviderValidation } from '../provider-validation'

// Retained alias so existing importers keep compiling; the canonical type now
// lives in ./core alongside the other shared function shapes.
export type ProviderApiFn = ApiFn

// A REAL, cost-bounded out-of-band credential probe for providers Hermes cannot itself
// validate (its _CREDENTIAL_PROBES omits Anthropic, whose auth is x-api-key + version
// headers, not Bearer). Runs in the main process (no browser CORS) against the provider's
// official endpoint (e.g. Anthropic GET /v1/models — zero token cost, no content retained).
// Never returns or logs the key. reachable:false ⇒ the probe could not run (offline / no
// probe) and is NOT proof; ok:false + reachable:true ⇒ the provider rejected the key.
export type ProviderCredentialProbe = (input: {
  provider: string
  envKey: string
  apiKey: string
  model: string | null
}) => Promise<{ ok: boolean; reachable: boolean; message?: string }>

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
  // Returns the activated model AND the non-secret validation EVIDENCE produced by the
  // live probe, so the caller can persist + gate on it (never re-derive trust from config).
  connectProvider(provider: string, apiKey: string): Promise<{ ok: boolean; model: string; validation: ProviderValidation }>
  listOAuthProviders(): Promise<OAuthProvider[]>
  startOAuth(provider: string): Promise<OAuthStart>
  pollOAuth(provider: string, sessionId: string): Promise<OAuthPoll>
  cancelOAuth(sessionId: string): Promise<{ ok: boolean }>
  activateProvider(provider: string): Promise<{ ok: boolean; model: string }>
}

export function createProviderApi(api: ApiFn, probeCredential?: ProviderCredentialProbe): HermesProviderApi {
  const resolveDefaultModel = async (provider: string) => {
    const recommended = await api<{ model: string }>(
      `/api/model/recommended-default?provider=${encodeURIComponent(provider)}`
    )
    if (!recommended.model) throw new Error('Hermes did not provide a compatible default model for this provider')
    return recommended.model
  }
  const setMainModel = (provider: string, model: string) =>
    api('/api/model/set', {
      method: 'POST',
      body: { scope: 'main', provider, model, confirm_expensive_model: true }
    })
  const activateProvider = async (provider: string) => {
    const model = await resolveDefaultModel(provider)
    await setMainModel(provider, model)
    return { ok: true, model }
  }

  return {
    async connectProvider(provider: string, apiKey: string) {
      const envKey = PROVIDER_API_KEYS[provider]
      if (!envKey) throw new Error('Provider is not supported by this quick setup')
      // Resolve the exact model to activate FIRST, so the validation evidence is scoped to
      // the precise provider+model (closes the model=null hole where evidence vouched for any model).
      const model = await resolveDefaultModel(provider)

      // Live probe via Hermes: real for OpenAI/OpenRouter/xAI/Gemini; for a provider Hermes
      // cannot probe (Anthropic) it returns ok:true, reachable:false — which is NOT proof.
      const validate = await api<{ ok?: boolean; reachable?: boolean; message?: string }>('/api/providers/validate', {
        method: 'POST',
        body: { key: envKey, value: apiKey }
      })
      let reachable = validate.reachable === true
      if (validate.ok === false) {
        // Actively rejected by the provider (only meaningful when reachable) → never accept.
        throw new Error(
          validate.message || (reachable ? 'מפתח ה־API נדחה על ידי הספק' : 'לא ניתן היה להגיע לספק כדי לאמת את המפתח')
        )
      }
      if (!reachable) {
        // No Hermes probe for this provider. ok:true here is unproven — run a REAL,
        // cost-bounded official probe, or FAIL HONESTLY. Never save an unverified key.
        if (!probeCredential) {
          throw new Error('לא ניתן לאמת ספק זה בסביבה הנוכחית; חבר/י דרך היישום המותקן או בחר/י ספק נתמך')
        }
        const probe = await probeCredential({ provider, envKey, apiKey, model })
        if (!probe.ok || !probe.reachable) {
          throw new Error(probe.message || 'לא ניתן היה לאמת את מפתח הספק מול נקודת הקצה הרשמית')
        }
        reachable = true
      }

      // Verified live → persist the key and activate the exact model.
      await api('/api/env', { method: 'PUT', body: { key: envKey, value: apiKey } })
      await setMainModel(provider, model)

      // Non-secret, timestamped evidence scoped to this exact provider+model.
      const validation = recordValidation({
        provider,
        model,
        now: new Date().toISOString(),
        response: { ok: true, reachable },
        method: 'validate'
      })
      return { ok: true, model, validation }
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
