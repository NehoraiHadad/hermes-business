import type { OnboardingData } from './onboarding-contract'
import type { ProviderStatus } from './provider-readiness'

export const BOOTSTRAP_COMMAND: string

export function buildBootstrapPrompt(input?: {
  snapshot?: Record<string, unknown>
  // Accepts canonical answers or any persisted/legacy shape; it is normalized first.
  data?: Partial<OnboardingData> | Record<string, unknown>
}): string

export function buildVerifiedSnapshot(input?: {
  runtime?: { running?: boolean; version?: string | null } | null
  skills?: Array<{ name: string }>
  tasks?: unknown[]
  connections?: Array<{ id: string; state: string; official?: boolean }>
  providerStatus?: ProviderStatus
  oauthProviders?: Array<{ name: string; status?: { logged_in?: boolean } }> | null
  env?: Record<string, { is_set?: boolean }> | null
  error?: unknown
}): Record<string, unknown>

export function buildModelSnapshot(input?: {
  model?: unknown
  gateway?: unknown
  profile?: string
  skills?: string[]
  scheduledTasks?: number
}): Record<string, unknown>
