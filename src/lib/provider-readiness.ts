import type { OAuthProvider } from './hermes/providers'

export type ProviderReadiness = {
  connected: boolean
  label: string
}

const API_KEY_PROVIDERS: Array<[string, string]> = [
  ['OPENROUTER_API_KEY', 'OpenRouter'],
  ['ANTHROPIC_API_KEY', 'Anthropic'],
  ['GEMINI_API_KEY', 'Gemini'],
  ['OPENAI_API_KEY', 'OpenAI']
]

export function resolveProviderReadiness(
  oauthProviders: OAuthProvider[],
  env: Record<string, { is_set?: boolean }>
): ProviderReadiness {
  const oauth = oauthProviders.find(provider => provider.status?.logged_in)
  if (oauth) return { connected: true, label: oauth.name }

  const apiKey = API_KEY_PROVIDERS.find(([key]) => env[key]?.is_set)
  if (apiKey) return { connected: true, label: apiKey[1] }

  return { connected: false, label: 'לא מחובר' }
}
