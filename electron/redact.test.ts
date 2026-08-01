import { describe, expect, it } from 'vitest'
// @ts-expect-error - plain CJS module without type declarations
import { redactEmails, redactSecrets } from './redact.cjs'

describe('redactEmails', () => {
  it('strips the local part but preserves the domain', () => {
    expect(redactEmails('jane.doe@shop.co.il')).toBe('<redacted>@shop.co.il')
    expect(redactEmails('contact owner+sales@example.com now')).toBe('contact <redacted>@example.com now')
  })

  it('redacts every address in free text while keeping surrounding words', () => {
    expect(redactEmails('from a@a.io to b_c@sub.b-corp.net')).toBe('from <redacted>@a.io to <redacted>@sub.b-corp.net')
  })

  it('is idempotent — a second pass does not corrupt an already-redacted address', () => {
    const once = redactEmails('user@gmail.com')
    expect(once).toBe('<redacted>@gmail.com')
    expect(redactEmails(once)).toBe('<redacted>@gmail.com')
  })

  it('leaves technical strings without a real email untouched', () => {
    expect(redactEmails('ws://127.0.0.1:9119/api/ws')).toBe('ws://127.0.0.1:9119/api/ws')
    expect(redactEmails('user@localhost')).toBe('user@localhost')
    expect(redactEmails('version 0.19.1 build 2026.7.30')).toBe('version 0.19.1 build 2026.7.30')
    expect(redactEmails(null)).toBe('')
  })
})

describe('redactSecrets', () => {
  it('scrubs emails and secret shapes together', () => {
    const raw = '{"owner":"jo@acme.com","api_key":"live_supersecretvalue","key":"sk-ABCDEFGHIJKL0123"}'
    const out = redactSecrets(raw)
    expect(out).toContain('<redacted>@acme.com')
    expect(out).not.toContain('jo@acme.com')
    expect(out).not.toContain('live_supersecretvalue')
    expect(out).not.toContain('sk-ABCDEFGHIJKL0123')
  })

  it('is idempotent', () => {
    const raw = 'mail x@y.com token ?token=abcdEFGH1234'
    expect(redactSecrets(redactSecrets(raw))).toBe(redactSecrets(raw))
  })
})
