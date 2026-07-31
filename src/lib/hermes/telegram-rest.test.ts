import { describe, expect, it, vi } from 'vitest'
import { createHermesRest } from './rest'

describe('Telegram REST wiring', () => {
  it('ensures the background gateway before restarting and verifying Telegram', async () => {
    const events: string[] = []
    const api = vi.fn(async (endpoint: string) => {
      events.push(endpoint)
      return endpoint.includes('/test') ? { ok: true, state: 'connected' } : {}
    })
    const ensureGateway = vi.fn(async () => {
      events.push('ensure-gateway')
    })

    const rest = createHermesRest(api as never, ensureGateway)
    await rest.connectTelegram('secret-token', '123456789')

    expect(events).toEqual([
      '/api/messaging/platforms/telegram?profile=default',
      'ensure-gateway',
      '/api/gateway/restart?profile=default',
      '/api/messaging/platforms/telegram/test?profile=default'
    ])
    expect(ensureGateway).toHaveBeenCalledOnce()
  })
})
