import { describe, expect, it } from 'vitest'
import type { WhatsappOnboarding } from './rest'
import { describeOnboarding, isTerminalOnboardingStatus } from './whatsapp-onboarding'

function onboarding(partial: Partial<WhatsappOnboarding>): WhatsappOnboarding {
  return {
    pairing_id: 'p1',
    status: 'waiting',
    expires_at: '2026-01-01T00:00:00Z',
    mode: 'bot',
    ...partial
  }
}

describe('WhatsApp QR onboarding lifecycle', () => {
  it('treats connected/error/expired/cancelled as terminal and waiting/starting as pollable', () => {
    for (const status of ['connected', 'error', 'expired', 'cancelled'] as const) {
      expect(isTerminalOnboardingStatus(status)).toBe(true)
    }
    for (const status of ['starting', 'installing', 'waiting'] as const) {
      expect(isTerminalOnboardingStatus(status)).toBe(false)
    }
  })

  it('describes each status for a nontechnical user', () => {
    expect(describeOnboarding(onboarding({ status: 'waiting' }))).toContain('QR')
    expect(describeOnboarding(onboarding({ status: 'connected', account_phone: '+972...' }))).toContain('+972...')
    expect(describeOnboarding(onboarding({ status: 'error', error: 'boom' }))).toBe('boom')
    expect(describeOnboarding(onboarding({ status: 'expired' }))).toContain('פג')
  })
})
