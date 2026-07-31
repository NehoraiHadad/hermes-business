import { describe, expect, it, vi } from 'vitest'
import {
  createVerifyToken,
  validateCloudCredentials,
  webhookCallback
} from './whatsapp-cloud-config'

describe('official WhatsApp Cloud setup helpers', () => {
  it('accepts the same credential shapes as the Hermes wizard', () => {
    expect(
      validateCloudCredentials({
        phoneNumberId: '7794189252778687',
        accessToken: `EAA${'x'.repeat(100)}`,
        appSecret: 'a'.repeat(32)
      })
    ).toHaveProperty('credentials.phoneNumberId', '7794189252778687')
  })

  it('explains common credential mix-ups before persisting', () => {
    expect(
      validateCloudCredentials({
        phoneNumberId: '+972500000000',
        accessToken: 'sk-not-meta',
        appSecret: 'wrong'
      })
    ).toHaveProperty('error')
  })

  it('generates a random token without storing credentials in UI state', () => {
    const getRandomValues = vi.spyOn(crypto, 'getRandomValues').mockImplementation(array => {
      if (!array) throw new Error('Expected a typed array')
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(10)
      return array
    })
    expect(createVerifyToken()).toBe('0a'.repeat(32))
    getRandomValues.mockRestore()
  })

  it('builds the callback path expected by the Hermes Cloud adapter', () => {
    expect(webhookCallback('https://assistant.example.com/')).toBe(
      'https://assistant.example.com/whatsapp/webhook'
    )
  })
})
