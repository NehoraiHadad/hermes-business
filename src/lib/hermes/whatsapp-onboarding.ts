import type { WhatsappOnboarding } from './rest'

// Pure classification of the QR onboarding lifecycle so both the hook and its
// tests agree on when to stop polling and what to show the user.

export const TERMINAL_ONBOARDING_STATUSES: ReadonlySet<WhatsappOnboarding['status']> = new Set([
  'connected',
  'error',
  'expired',
  'cancelled'
])

export function isTerminalOnboardingStatus(status: WhatsappOnboarding['status']): boolean {
  return TERMINAL_ONBOARDING_STATUSES.has(status)
}

export function describeOnboarding(onboarding: WhatsappOnboarding): string {
  switch (onboarding.status) {
    case 'starting':
    case 'installing':
      return 'מכינים את החיבור ל־WhatsApp Web…'
    case 'waiting':
      return 'סרוק את קוד ה־QR באפליקציית WhatsApp: הגדרות ← מכשירים מקושרים ← קישור מכשיר.'
    case 'connected':
      return onboarding.account_phone
        ? `מחובר בהצלחה כ־${onboarding.account_phone}.`
        : 'מחובר בהצלחה.'
    case 'expired':
      return 'קוד ה־QR פג. סגור ונסה שוב כדי לקבל קוד חדש.'
    case 'cancelled':
      return 'החיבור בוטל.'
    case 'error':
    default:
      return onboarding.error || 'החיבור נכשל. נסה שוב.'
  }
}
