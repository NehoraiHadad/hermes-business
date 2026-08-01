import type { Connection, ScheduledTask, Skill } from '../types'
import type { ProviderStatus } from './provider-readiness'
import { buildVerifiedSnapshot as buildSnapshot } from '../../shared/onboarding-bootstrap.js'

// The bounded, wrapper-verified snapshot handed to onboarding. `provider_ready` is
// the honest, provider-usable signal (see providerStatus) — never runtime uptime.
export function buildVerifiedSnapshot(input: {
  runtime: HermesRuntime | null
  skills: Skill[]
  tasks: ScheduledTask[]
  connections: Connection[]
  providerStatus?: ProviderStatus
}): Record<string, unknown> {
  return buildSnapshot(input)
}
