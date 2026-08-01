import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { deriveLegacyTelegramPolicy, migrateTelegramPolicy } = require('../../electron/telegram-migrate.cjs')

describe('Telegram legacy migration', () => {
  it('leaves an unconfigured bot untouched', () => {
    expect(deriveLegacyTelegramPolicy({})).toBeNull()
  })

  it('preserves an allow-all bot as full_access', () => {
    expect(
      deriveLegacyTelegramPolicy({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_ALLOW_ALL_USERS: 'true' })
    ).toEqual({ version: 1, mode: 'full_access', reply_chats: [] })
  })

  it('preserves an explicit allowlist as selected_chats (users + group chats)', () => {
    expect(
      deriveLegacyTelegramPolicy({
        TELEGRAM_BOT_TOKEN: 't',
        TELEGRAM_ALLOWED_USERS: '123, 456',
        TELEGRAM_GROUP_ALLOWED_CHATS: '-100999'
      })
    ).toEqual({ version: 1, mode: 'selected_chats', reply_chats: ['123', '456', '-100999'] })
  })

  it('drops a wildcard and defaults a configured-but-ambiguous bot to read_only', () => {
    expect(
      deriveLegacyTelegramPolicy({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_ALLOWED_USERS: '*' })
    ).toEqual({ version: 1, mode: 'read_only', reply_chats: [] })
    expect(deriveLegacyTelegramPolicy({ TELEGRAM_BOT_TOKEN: 't' })).toEqual({
      version: 1,
      mode: 'read_only',
      reply_chats: []
    })
  })

  it('never overwrites an existing explicit policy', () => {
    const writePolicy = vi.fn()
    const result = migrateTelegramPolicy({
      hasPolicy: () => true,
      readEnv: () => ({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_ALLOW_ALL_USERS: 'true' }),
      writePolicy
    })
    expect(result).toEqual({ migrated: false, reason: 'policy-exists' })
    expect(writePolicy).not.toHaveBeenCalled()
  })

  it('writes the derived policy when none exists yet', () => {
    const writePolicy = vi.fn()
    const result = migrateTelegramPolicy({
      hasPolicy: () => false,
      readEnv: () => ({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_ALLOWED_USERS: '123' }),
      writePolicy
    })
    expect(result).toEqual({ migrated: true, mode: 'selected_chats' })
    expect(writePolicy).toHaveBeenCalledWith({
      version: 1,
      mode: 'selected_chats',
      reply_chats: ['123']
    })
  })
})
