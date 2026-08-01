import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import type { TelegramPolicy } from './telegram-policy'

const require = createRequire(import.meta.url)
const { telegramEnvForPolicy, saveTelegramPolicySynced } = require('../../electron/telegram-policy-sync.cjs')

describe('Telegram policy synchronization', () => {
  it('splits selected targets into user and group-chat allowlists', () => {
    expect(
      telegramEnvForPolicy({
        version: 1,
        mode: 'selected_chats',
        reply_chats: ['123', '-1001234567890', 'mybot']
      })
    ).toEqual({
      env: {
        TELEGRAM_ALLOWED_USERS: '123,mybot',
        TELEGRAM_GROUP_ALLOWED_CHATS: '-1001234567890'
      },
      clear_env: []
    })
  })

  it('clears the managed group-chat narrowing in read-only and full-access', () => {
    for (const mode of ['read_only', 'full_access'] as const) {
      expect(telegramEnvForPolicy({ version: 1, mode, reply_chats: [] })).toEqual({
        env: {},
        clear_env: ['TELEGRAM_GROUP_ALLOWED_CHATS']
      })
    }
  })

  it('uses the official telegram platform API and restarts an enabled gateway', async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce({ platforms: [{ id: 'telegram', enabled: true }] })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
    const writePolicy = vi.fn((policy: TelegramPolicy) => policy)

    const result = await saveTelegramPolicySynced(
      { version: 1, mode: 'selected_chats', reply_chats: ['123'] },
      { api, writePolicy }
    )

    expect(api).toHaveBeenNthCalledWith(2, '/api/messaging/platforms/telegram?profile=default', {
      method: 'PUT',
      body: {
        env: { TELEGRAM_ALLOWED_USERS: '123' },
        clear_env: ['TELEGRAM_GROUP_ALLOWED_CHATS']
      }
    })
    expect(api).toHaveBeenNthCalledWith(3, '/api/gateway/restart?profile=default', { method: 'POST' })
    expect(writePolicy).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ nativeSynced: true, gatewayRestarted: true })
  })

  it('does not restart before Telegram has been enabled', async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce({ platforms: [{ id: 'telegram', enabled: false }] })
      .mockResolvedValueOnce({ ok: true })

    const result = await saveTelegramPolicySynced(
      { version: 1, mode: 'read_only', reply_chats: [] },
      { api, writePolicy: (policy: TelegramPolicy) => policy }
    )

    expect(api).toHaveBeenCalledTimes(2)
    expect(result.gatewayRestarted).toBe(false)
  })
})
