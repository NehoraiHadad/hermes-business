import { describe, expect, it } from 'vitest'
// @ts-expect-error - plain CJS module without type declarations
import { redactEmails, redactPaths, redactSecrets } from './redact.cjs'
import { FAKE_EMAIL, FAKE_SECRETS, FAKE_SECRET_VALUES, PERSONAL_PATHS, PERSONAL_USERNAME } from './redaction-fixtures'

describe('redactEmails', () => {
  it('strips the local part but preserves the domain', () => {
    expect(redactEmails('jane.doe@shop.co.il')).toBe('<redacted>@shop.co.il')
    expect(redactEmails('contact owner+sales@example.com now')).toBe('contact <redacted>@example.com now')
  })

  it('is idempotent and leaves technical strings without a real email untouched', () => {
    expect(redactEmails(redactEmails('user@gmail.com'))).toBe('<redacted>@gmail.com')
    expect(redactEmails('ws://127.0.0.1:9119/api/ws')).toBe('ws://127.0.0.1:9119/api/ws')
    expect(redactEmails('user@localhost')).toBe('user@localhost')
    expect(redactEmails('version 0.19.1 build 2026.7.30')).toBe('version 0.19.1 build 2026.7.30')
    expect(redactEmails(null)).toBe('')
  })
})

describe('redactPaths', () => {
  it('strips the account name from Windows home paths, keeping the rest', () => {
    expect(redactPaths(PERSONAL_PATHS.windows)).toBe('C:\\Users\\<redacted>\\AppData\\Roaming\\Hermes\\config.json')
    expect(redactPaths(PERSONAL_PATHS.windowsFwd)).toBe('C:/Users/<redacted>/AppData/Roaming')
    expect(redactPaths('d:\\users\\Someone\\file.log')).toBe('d:\\users\\<redacted>\\file.log')
  })

  it('strips the account name from POSIX and macOS home paths', () => {
    expect(redactPaths(PERSONAL_PATHS.posixHome)).toBe('/home/<redacted>/.hermes/config.json')
    expect(redactPaths(PERSONAL_PATHS.macUsers)).toBe('/Users/<redacted>/Library/Application Support/Hermes')
  })

  it('redacts a path embedded in error text without touching the message', () => {
    const err = "Error: ENOENT: no such file or directory, open '/home/testuser/.hermes/config.json'"
    expect(redactPaths(err)).toBe("Error: ENOENT: no such file or directory, open '/home/<redacted>/.hermes/config.json'")
    expect(redactPaths(err)).not.toContain(PERSONAL_USERNAME)
  })

  it('does not corrupt ordinary text, URL path segments, or version banners', () => {
    expect(redactPaths('version 0.19.1 gateway_state running arch x64')).toBe('version 0.19.1 gateway_state running arch x64')
    expect(redactPaths('https://status.example.com/home/dashboard')).toBe('https://status.example.com/home/dashboard')
    expect(redactPaths('relative users/data/cache')).toBe('relative users/data/cache')
    expect(redactPaths(null)).toBe('')
  })

  it('is idempotent', () => {
    const once = redactPaths(PERSONAL_PATHS.windows)
    expect(redactPaths(once)).toBe(once)
    const posix = redactPaths(PERSONAL_PATHS.macUsers)
    expect(redactPaths(posix)).toBe(posix)
  })
})

describe('redactSecrets', () => {
  it('strips every secret shape that can reach diagnostics free-text', () => {
    const raw = [
      `auth: ${FAKE_SECRETS.bearer}`,
      `key=${FAKE_SECRETS.openai}`,
      `google ${FAKE_SECRETS.google}`,
      `bot ${FAKE_SECRETS.telegram}`,
      `?${FAKE_SECRETS.refreshQuery}`,
      `{${FAKE_SECRETS.accessJson}}`,
      `owner ${FAKE_EMAIL}`
    ].join('\n')
    const out = redactSecrets(raw)
    for (const value of FAKE_SECRET_VALUES) expect(out).not.toContain(value)
    expect(out).toContain('<redacted>@shop.example')
    expect(out).not.toContain(FAKE_EMAIL)
    expect(out).toContain('Bearer <redacted>')
  })

  it('also strips personal home paths as part of the combined scrub', () => {
    const out = redactSecrets(`config at ${PERSONAL_PATHS.windows} and ${PERSONAL_PATHS.posixHome}`)
    expect(out).not.toContain(PERSONAL_USERNAME)
    expect(out).toContain('C:\\Users\\<redacted>\\AppData')
    expect(out).toContain('/home/<redacted>/.hermes/config.json')
  })

  it('preserves ordinary version/status/error text', () => {
    const text = 'version 0.19.1 overall=degraded gateway_state=running active_agents=2'
    expect(redactSecrets(text)).toBe(text)
  })

  it('is idempotent', () => {
    const raw = `mail x@y.com token ?token=abcdEFGH1234 path ${PERSONAL_PATHS.posixHome}`
    expect(redactSecrets(redactSecrets(raw))).toBe(redactSecrets(raw))
  })
})
