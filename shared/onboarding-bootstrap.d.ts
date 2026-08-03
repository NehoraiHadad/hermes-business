import type { OnboardingData } from './onboarding-contract'
import type { ProviderStatus } from './provider-readiness'

export const BOOTSTRAP_COMMAND: string

export function buildBootstrapPrompt(input?: {
  snapshot?: Record<string, unknown>
  // Accepts canonical answers or any persisted/legacy shape; it is normalized first.
  data?: Partial<OnboardingData> | Record<string, unknown>
}): string

// The React/Electron agent-facing handoff payload built by buildVerifiedSnapshot.
// Field-for-field honest to shared/onboarding-bootstrap.js's buildVerifiedSnapshot —
// keep both in sync (enforced by src/lib/shared-contract-parity.test.ts for export
// shape; this interface additionally documents the payload's own field shape).
export interface VerifiedSnapshot {
  provider_ready: ProviderStatus['provider_ready']
  provider_state: ProviderStatus['provider_state']
  provider_label: ProviderStatus['provider_label']
  provider_configured: boolean
  provider_usable: boolean
  provider_sources: ProviderStatus['provider_sources']
  runtime_running: boolean
  hermes_version: string | null
  skills: string[]
  scheduled_tasks: number
  connections: Array<{ id: string; state: string; official: boolean }>
  // Existing callers (e.g. src/lib/onboarding-snapshot.ts, src/lib/onboarding-prompt.ts)
  // type this payload as Record<string, unknown> since it is forwarded opaquely into
  // WRAPPER_VERIFIED_SNAPSHOT=JSON.stringify(snapshot). The index signature keeps this
  // interface assignable to that shape without loosening the named fields above.
  [key: string]: unknown
}

export function buildVerifiedSnapshot(input?: {
  runtime?: { running?: boolean; compatible?: boolean; version?: string | null } | null
  skills?: Array<{ name: string }>
  tasks?: unknown[]
  connections?: Array<{ id: string; state: string; official?: boolean }>
  providerStatus?: ProviderStatus
  oauthProviders?: Array<{ name: string; status?: { logged_in?: boolean } }> | null
  env?: Record<string, { is_set?: boolean }> | null
  error?: unknown
}): VerifiedSnapshot

// The plugin-side agent-facing handoff payload built by buildModelSnapshot. Same
// honest-shape contract as VerifiedSnapshot but driven by the model id the desktop
// plugin can see (no provider_configured/provider_usable/provider_sources/connections —
// the plugin does not resolve those).
export interface ModelSnapshot {
  provider_ready: boolean
  provider_state: string
  provider_label: string
  model: unknown
  gateway: unknown
  profile: string
  skills: string[]
  scheduled_tasks: number
}

export function buildModelSnapshot(input?: {
  model?: unknown
  gateway?: unknown
  profile?: string
  skills?: string[]
  scheduledTasks?: number
}): ModelSnapshot
