import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  describeTelegramPolicy,
  normalizeTelegram,
  parseTelegramList,
  resolveTelegramConnectPolicy,
  validateTelegramPolicy
} from './telegram-policy'

const require = createRequire(import.meta.url)
const electron = require('../../electron/telegram-policy.cjs') as {
  normalizeTelegram: (v: string) => string
}

describe('Telegram policy helpers', () => {
  it('normalizes numeric ids, groups and usernames', () => {
    expect(normalizeTelegram('  123456789 ')).toBe('123456789')
    expect(normalizeTelegram('-1001234567890')).toBe('-1001234567890')
    expect(normalizeTelegram('007')).toBe('7')
    expect(normalizeTelegram('telegram:123')).toBe('123')
    expect(normalizeTelegram('@MyBot')).toBe('mybot')
    expect(normalizeTelegram('-0')).toBe('0')
    expect(normalizeTelegram('')).toBe('')
  })

  it('stays byte-identical to the electron normalizer (single source of truth)', () => {
    for (const value of ['123', '-1009', '@Foo', 'telegram:@Bar', '007', '  55  ', '@a_b']) {
      expect(normalizeTelegram(value)).toBe(electron.normalizeTelegram(value))
    }
  })

  it('parses and de-duplicates a mixed list', () => {
    expect(parseTelegramList('123, 123\n@Foo\n-100')).toEqual(['123', 'foo', '-100'])
  })

  it('requires at least one target in selected mode (fail closed)', () => {
    expect(validateTelegramPolicy('selected_chats', '   ')).toEqual({
      error: 'יש לבחור לפחות משתמש או קבוצה אחת שבהם מותר לעוזר לענות.'
    })
    expect(validateTelegramPolicy('read_only', '')).toEqual({
      policy: { version: 1, mode: 'read_only', reply_chats: [] }
    })
    expect(validateTelegramPolicy('full_access', '')).toEqual({
      policy: { version: 1, mode: 'full_access', reply_chats: [] }
    })
  })

  it('describes each mode distinctly', () => {
    const read = describeTelegramPolicy({ version: 1, mode: 'read_only', reply_chats: [] })
    const full = describeTelegramPolicy({ version: 1, mode: 'full_access', reply_chats: [] })
    const sel = describeTelegramPolicy({ version: 1, mode: 'selected_chats', reply_chats: ['1'] })
    expect(read).toContain('קריאה בלבד')
    expect(full).toContain('גישה מלאה')
    expect(sel).toContain('1')
  })

  it('defaults a fresh connection to owner-only replies', () => {
    expect(
      resolveTelegramConnectPolicy(
        { version: 1, mode: 'read_only', reply_chats: [] },
        '007',
        undefined
      )
    ).toEqual({ policy: { version: 1, mode: 'selected_chats', reply_chats: ['7'] } })
  })
})
