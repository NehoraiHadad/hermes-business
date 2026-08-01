export interface OnboardingData {
  userName: string
  role: string
  language: string
  responseStyle: string
  workHours: string
  approvals: string[]
  timeSavers: string
  businessName: string
  industry: string
  offerings: string
  customers: string
  businessHours: string
  communicationStyle: string
  restrictions: string
  recurringProcesses: string
  systems: string
}

export interface OnboardingField {
  key: keyof OnboardingData
  label: string
  multiline?: boolean
}

export interface OnboardingStep {
  title: string
  copy: string
  fields: OnboardingField[]
}

export const EMPTY_ONBOARDING: OnboardingData
export const ONBOARDING_KEYS: Array<keyof OnboardingData>
export const LEGACY_ALIASES: Record<string, keyof OnboardingData>
export const ONBOARDING_STEPS: OnboardingStep[]
export const STORAGE_KEYS: { complete: string; form: string; guided: string; pluginComplete: string }
export function normalizeOnboarding(raw: unknown): OnboardingData
