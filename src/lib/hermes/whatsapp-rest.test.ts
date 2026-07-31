import { describe, expect, it, vi } from 'vitest'
import { createHermesRest } from './rest'

type Call = { endpoint: string; method: string; body: unknown }

function harness() {
  const calls: Call[] = []
  const api = vi.fn(async (endpoint: string, init?: { method?: string; body?: unknown }) => {
    calls.push({ endpoint, method: init?.method || 'GET', body: init?.body })
    return {} as unknown
  })
  return { rest: createHermesRest(api as never), calls }
}

describe('WhatsApp onboarding REST wiring', () => {
  it('starts onboarding against the official Hermes endpoint with mode + allowed users', async () => {
    const { rest, calls } = harness()
    await rest.startWhatsappOnboarding('bot', '15551234567')
    expect(calls[0]).toEqual({
      endpoint: '/api/messaging/whatsapp/onboarding/start',
      method: 'POST',
      body: { mode: 'bot', allowed_users: '15551234567', profile: 'default' }
    })
  })

  it('polls, applies and cancels a pairing by id with URL encoding', async () => {
    const { rest, calls } = harness()
    await rest.pollWhatsappOnboarding('pair/1')
    await rest.applyWhatsappOnboarding('pair/1', 'self-chat', '')
    await rest.cancelWhatsappOnboarding('pair/1')
    expect(calls[0]).toMatchObject({ endpoint: '/api/messaging/whatsapp/onboarding/pair%2F1', method: 'GET' })
    expect(calls[1]).toMatchObject({
      endpoint: '/api/messaging/whatsapp/onboarding/pair%2F1/apply',
      method: 'POST',
      body: { mode: 'self-chat', allowed_users: '', profile: 'default' }
    })
    expect(calls[2]).toMatchObject({ endpoint: '/api/messaging/whatsapp/onboarding/pair%2F1', method: 'DELETE' })
  })

  it('stores Meta Cloud credentials through the official env API and restarts Hermes', async () => {
    const calls: Call[] = []
    const api = vi.fn(async (endpoint: string, init?: { method?: string; body?: unknown }) => {
      calls.push({ endpoint, method: init?.method || 'GET', body: init?.body })
      return endpoint.includes('/test') ? { ok: true, state: 'connected' } : {}
    })
    const rest = createHermesRest(api as never)
    await rest.configureWhatsappCloud({
      phoneNumberId: '7794189252778687',
      accessToken: `EAA${'x'.repeat(100)}`,
      appSecret: 'a'.repeat(32),
      verifyToken: 'verify'
    })
    expect(calls.slice(0, 4).map(call => (call.body as { key: string }).key)).toEqual([
      'WHATSAPP_CLOUD_APP_SECRET',
      'WHATSAPP_CLOUD_VERIFY_TOKEN',
      'WHATSAPP_CLOUD_ACCESS_TOKEN',
      'WHATSAPP_CLOUD_PHONE_NUMBER_ID'
    ])
    expect(calls[4]).toMatchObject({ endpoint: '/api/gateway/restart?profile=default', method: 'POST' })
    expect(calls[5]).toMatchObject({
      endpoint: '/api/messaging/platforms/whatsapp_cloud/test?profile=default',
      method: 'POST'
    })
  })
})
