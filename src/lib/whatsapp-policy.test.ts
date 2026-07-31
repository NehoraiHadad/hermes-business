import { describe, expect, it } from 'vitest'
import {
  allowedUsersForPolicy,
  DEFAULT_WHATSAPP_POLICY,
  chatsToText,
  normalizeChat,
  parseChatList,
  validateWhatsappPolicy
} from './whatsapp-policy'

describe('WhatsApp reply-policy helpers', () => {
  it('defaults to fail-closed read-only', () => {
    expect(DEFAULT_WHATSAPP_POLICY).toEqual({ version: 1, mode: 'read_only', reply_chats: [] })
  })

  it('maps selected direct chats into the native Hermes allowlist', () => {
    expect(allowedUsersForPolicy(DEFAULT_WHATSAPP_POLICY)).toBe('')
    expect(
      allowedUsersForPolicy({
        version: 1,
        mode: 'selected_chats',
        reply_chats: ['972500000001', '972500000002']
      })
    ).toBe('972500000001,972500000002')
  })

  it('normalizes phone/JID/prefixed identifiers to bare digits', () => {
    expect(normalizeChat('WhatsApp:+15551234567')).toBe('15551234567')
    expect(normalizeChat('+15551234567')).toBe('15551234567')
    expect(normalizeChat('15551234567@s.whatsapp.net')).toBe('15551234567')
    expect(normalizeChat('whatsapp_cloud:15551234567@lid')).toBe('15551234567')
  })

  it('parses and de-duplicates a mixed comma/newline chat list', () => {
    expect(parseChatList('+15551234567, 15551234567@s.whatsapp.net\n\nwhatsapp:15550000000')).toEqual([
      '15551234567',
      '15550000000'
    ])
    expect(chatsToText(['a', 'b'])).toBe('a\nb')
  })

  it('rejects selected mode with no chats and accepts read-only regardless', () => {
    expect(validateWhatsappPolicy('selected_chats', '   ')).toEqual({
      error: 'יש לבחור לפחות צ׳אט אחד שבו מותר לעוזר לענות.'
    })
    expect(validateWhatsappPolicy('read_only', '   ')).toEqual({
      policy: { version: 1, mode: 'read_only', reply_chats: [] }
    })
    expect(validateWhatsappPolicy('selected_chats', '+1 (555) 123-4567')).toEqual({
      policy: { version: 1, mode: 'selected_chats', reply_chats: ['15551234567'] }
    })
  })
})
