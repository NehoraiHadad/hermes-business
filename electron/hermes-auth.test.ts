import { describe, expect, it } from 'vitest'
import { SESSION_HEADER, authHeaders, wsUrlWithToken } from './hermes-auth.cjs'

describe('authHeaders', () => {
  it('prefers X-Hermes-Session-Token and keeps the legacy Bearer for compat', () => {
    const headers = authHeaders('tok-123')
    expect(SESSION_HEADER).toBe('X-Hermes-Session-Token')
    expect(headers[SESSION_HEADER]).toBe('tok-123')
    expect(headers.Authorization).toBe('Bearer tok-123')
  })

  it('merges extra headers (e.g. Content-Type) without dropping auth', () => {
    const headers = authHeaders('tok', { 'Content-Type': 'application/json' })
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers[SESSION_HEADER]).toBe('tok')
    expect(headers.Authorization).toBe('Bearer tok')
  })

  it('lets an explicit override win over the defaults', () => {
    const headers = authHeaders('tok', { Authorization: 'Bearer other' })
    expect(headers.Authorization).toBe('Bearer other')
  })
})

describe('wsUrlWithToken', () => {
  it('appends the loopback session token as the ?token= query param', () => {
    expect(wsUrlWithToken('ws://127.0.0.1:9119/api/ws', 'a b')).toBe(
      'ws://127.0.0.1:9119/api/ws?token=a%20b'
    )
  })

  it('uses & when the base URL already has a query string', () => {
    expect(wsUrlWithToken('ws://h/api/ws?x=1', 'tok')).toBe('ws://h/api/ws?x=1&token=tok')
  })
})
