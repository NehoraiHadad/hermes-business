import { describe, expect, it } from 'vitest'
import {
  allowedUsersForPolicy,
  DEFAULT_WHATSAPP_POLICY,
  chatsToText,
  describeWhatsappProtection,
  interpretWhatsappGuard,
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

describe('interpretWhatsappGuard — live proof, fail closed to no-proof', () => {
  it('returns null unless the plugin is positively loaded', () => {
    expect(interpretWhatsappGuard(null)).toBeNull()
    expect(interpretWhatsappGuard({})).toBeNull()
    expect(interpretWhatsappGuard({ mode: 'read_only' })).toBeNull() // a file/mode alone is not proof
    expect(interpretWhatsappGuard({ loaded: false, hooks: ['pre_gateway_dispatch'] })).toBeNull()
  })

  it('derives enforcing from the live hook registration and reads the mode', () => {
    expect(interpretWhatsappGuard({ plugin_loaded: true, hooks: ['pre_gateway_dispatch'], mode: 'read_only' })).toEqual({
      pluginLoaded: true,
      enforcing: true,
      mode: 'read_only',
      replyChats: undefined
    })
    // Loaded but the enforcement hook is NOT registered → not enforcing.
    expect(interpretWhatsappGuard({ plugin_loaded: true, hooks: [], mode: 'read_only' })?.enforcing).toBe(false)
  })
})

describe('describeWhatsappProtection — requires LIVE guard proof, not a policy file', () => {
  const guard = (over: Partial<import('./whatsapp-policy').WhatsappGuardStatus> = {}) => ({
    pluginLoaded: true,
    enforcing: true,
    mode: 'read_only' as const,
    ...over
  })

  it('shows nothing when no WhatsApp channel is connected', () => {
    expect(describeWhatsappProtection({ cloudConnected: false, qrConnected: false, guard: guard() })).toBeNull()
  })

  it('reads UNKNOWN/unprotected when there is NO live proof (a policy file is not proof)', () => {
    expect(describeWhatsappProtection({ cloudConnected: true, qrConnected: false, guard: null })).toMatchObject({ state: 'error' })
    expect(describeWhatsappProtection({ cloudConnected: true, qrConnected: false, guard: undefined })).toMatchObject({ state: 'error' })
    // Loaded but not enforcing is still unknown/unprotected.
    expect(describeWhatsappProtection({ cloudConnected: true, qrConnected: false, guard: guard({ enforcing: false }) })).toMatchObject({ state: 'error' })
  })

  it('flags a live-enforcing guard with NO valid mode as unprotected (error)', () => {
    expect(describeWhatsappProtection({ cloudConnected: true, qrConnected: false, guard: guard({ mode: null }) })).toMatchObject({ state: 'error' })
  })

  it('reports read-only and selected-chats live enforcement as protected', () => {
    expect(describeWhatsappProtection({ cloudConnected: true, qrConnected: false, guard: guard() })).toEqual({
      value: 'קריאה בלבד (מוגן, נאכף בשרת)',
      state: 'ok'
    })
    expect(
      describeWhatsappProtection({ cloudConnected: false, qrConnected: true, guard: guard({ mode: 'selected_chats', replyChats: 2 }) })
    ).toEqual({ value: 'מענה לנבחרים בלבד (2) — נאכף בשרת', state: 'ok' })
  })
})
