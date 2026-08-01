export interface ProviderReadiness {
  connected: boolean
  label: string
}

export type SourceState = 'positive' | 'negative' | 'unknown'

export interface ProviderStatus {
  provider_ready: boolean
  provider_state: 'usable' | 'configured' | 'runtime_only' | 'unavailable' | 'unknown'
  provider_label: string
  runtime_running: boolean
  provider_configured: boolean
  provider_usable: boolean
  provider_sources: { oauth: SourceState; env: SourceState }
}

export interface ModelReadiness {
  provider_ready: boolean
  provider_state: string
  provider_label: string
  provider_configured: boolean
}

export const DISCONNECTED_LABEL: string
export const API_KEY_PROVIDERS: Array<[string, string]>

export function resolveProviderReadiness(
  oauthProviders: Array<{ name: string; status?: { logged_in?: boolean }; [key: string]: unknown }> | null | undefined,
  env: Record<string, { is_set?: boolean }> | null | undefined
): ProviderReadiness

export function resolveProviderStatus(input?: {
  runtime?: { running?: boolean; compatible?: boolean; version?: string | null } | null
  oauthProviders?: Array<{ name: string; status?: { logged_in?: boolean }; [key: string]: unknown }> | null
  env?: Record<string, { is_set?: boolean }> | null
  error?: unknown
}): ProviderStatus

export function resolveModelReadiness(model: unknown): ModelReadiness
