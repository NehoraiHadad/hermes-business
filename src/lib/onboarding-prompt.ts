import type { OnboardingData } from '../types'
import { buildBootstrapPrompt } from '../../shared/onboarding-bootstrap.js'

// Thin wrapper over the canonical bootstrap payload so React and the plugin emit the
// exact same /business-bootstrap handoff (one question at a time, no giant prompt).
export function buildOnboardingPrompt(
  data: OnboardingData,
  verifiedSnapshot: Record<string, unknown>
): string {
  return buildBootstrapPrompt({ snapshot: verifiedSnapshot, data })
}
