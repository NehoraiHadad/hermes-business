import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import type { WhatsappPolicy } from './whatsapp-policy'

const require = createRequire(import.meta.url)
const {
  cloudEnvForPolicy,
  nativeUpdateForPolicy,
  saveWhatsappPolicySynced
} = require('../../electron/whatsapp-policy-sync.cjs')

const DEFAULT: WhatsappPolicy = {
  version: 2, mode: 'read_only', behavior: 'monitor', instructions: '', reply_chats: [], reply_groups: [], sources: []
}

describe('WhatsApp policy synchronization', () => {
  it('maps read-only to pairing intake with the native allowlist cleared', () => {
    expect(
      nativeUpdateForPolicy({ version: 2, mode: 'read_only', behavior: 'monitor', instructions: '', reply_chats: [], reply_groups: [], sources: [] })
    ).toEqual({
      env: { WHATSAPP_DM_POLICY: 'pairing' },
      clear_env: ['WHATSAPP_ALLOWED_USERS']
    })
  })

  it('maps selected chats to the official Hermes allowlist', () => {
    expect(
      nativeUpdateForPolicy({
        version: 2,
        mode: 'selected_chats',
        behavior: 'monitor', instructions: '', reply_groups: [],
        reply_chats: ['972500000000', '15551234567'],
        sources: [
          { id: '972500000000@s.whatsapp.net', name: 'א', type: 'dm', platform: 'whatsapp' },
          { id: '15551234567@lid', name: 'ב', type: 'dm', platform: 'whatsapp' }
        ]
      })
    ).toEqual({
      env: {
        WHATSAPP_DM_POLICY: 'allowlist',
        WHATSAPP_ALLOWED_USERS: '972500000000,15551234567'
      },
      clear_env: []
    })
  })

  it('keeps Cloud intake open but authorizes only selected chats', () => {
    expect(
      cloudEnvForPolicy({
        version: 2,
        mode: 'selected_chats',
        behavior: 'monitor', instructions: '', reply_groups: [],
        reply_chats: ['972500000000'],
        sources: [{ id: '972500000000', name: 'א', type: 'dm', platform: 'whatsapp_cloud' }]
      })
    ).toEqual({
      WHATSAPP_CLOUD_DM_POLICY: 'allowlist',
      WHATSAPP_CLOUD_ALLOWED_USERS: '972500000000'
    })
    expect(
      cloudEnvForPolicy({ version: 2, mode: 'read_only', behavior: 'monitor', instructions: '', reply_chats: [], reply_groups: [], sources: [] })
    ).toEqual({
      WHATSAPP_CLOUD_DM_POLICY: 'pairing',
      WHATSAPP_CLOUD_ALLOWED_USERS: ''
    })
  })

  it('uses official messaging APIs and restarts an enabled gateway', async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce({ platforms: [{ id: 'whatsapp', enabled: true }] })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
    const writePolicy = vi.fn(policy => policy)

    const result = await saveWhatsappPolicySynced(
      {
        version: 2, mode: 'selected_chats', behavior: 'monitor', instructions: '',
        reply_chats: ['972500000000'], reply_groups: [],
        sources: [
          { id: '+972-50-000-0000', name: 'QR', type: 'dm', platform: 'whatsapp' },
          { id: '+972-50-000-0000', name: 'Cloud', type: 'dm', platform: 'whatsapp_cloud' }
        ]
      },
      { api, writePolicy, previousPolicy: DEFAULT, applyMonitoring: vi.fn() }
    )

    expect(api).toHaveBeenNthCalledWith(2, '/api/messaging/platforms/whatsapp?profile=default', {
      method: 'PUT',
      body: {
        env: {
          WHATSAPP_DM_POLICY: 'allowlist',
          WHATSAPP_ALLOWED_USERS: '972500000000'
        },
        clear_env: []
      }
    })
    expect(api).toHaveBeenNthCalledWith(3, '/api/env?profile=default', {
      method: 'PUT',
      body: {
        key: 'WHATSAPP_CLOUD_DM_POLICY',
        value: 'allowlist',
        profile: 'default'
      }
    })
    expect(api).toHaveBeenNthCalledWith(4, '/api/env?profile=default', {
      method: 'PUT',
      body: {
        key: 'WHATSAPP_CLOUD_ALLOWED_USERS',
        value: '972500000000',
        profile: 'default'
      }
    })
    expect(api).toHaveBeenNthCalledWith(5, '/api/gateway/restart?profile=default', {
      method: 'POST'
    })
    expect(api).toHaveBeenNthCalledWith(6, '/api/health')
    expect(writePolicy).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ nativeSynced: true, gatewayRestarted: true, healthChecked: true })
  })

  it('does not restart before WhatsApp has been enabled', async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce({ platforms: [{ id: 'whatsapp', enabled: false }] })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })

    const result = await saveWhatsappPolicySynced(
      { version: 2, mode: 'read_only', behavior: 'monitor', instructions: '', reply_chats: [], reply_groups: [], sources: [] },
      { api, writePolicy: (policy: WhatsappPolicy) => policy, previousPolicy: DEFAULT, applyMonitoring: vi.fn() }
    )

    expect(api).toHaveBeenCalledTimes(4)
    expect(result.gatewayRestarted).toBe(false)
  })
})
