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

  it('strips the patterns migrated from the deleted security.cjs', () => {
    // These four shapes were guarded ONLY by security.cjs, which used to be the
    // redactor on the live runtime-log stream. They must now be covered here.
    const sessionHeader = redactSecrets(`GET /api/status\n${FAKE_SECRETS.sessionHeader}\naccept: application/json`)
    expect(sessionHeader).toContain('x-hermes-session-token: <redacted>')
    expect(sessionHeader).toContain('accept: application/json')

    expect(redactSecrets(`grant ${FAKE_SECRETS.googleRefresh} stored`)).toBe('grant <redacted> stored')
    expect(redactSecrets(FAKE_SECRETS.lowercaseBearer)).toBe('authorization: <redacted>')
    expect(redactSecrets(`https://oauth.example/token?${FAKE_SECRETS.clientSecretQuery}&grant_type=code`)).toBe(
      'https://oauth.example/token?client_secret=<redacted>&grant_type=code'
    )

    const all = redactSecrets(Object.values(FAKE_SECRETS).join('\n'))
    for (const value of FAKE_SECRET_VALUES) expect(all).not.toContain(value)
  })

  it('strips bare secret assignments (spawned command lines / env dumps)', () => {
    expect(redactSecrets(`bootstrap -Env refresh_token=${'FAKEfake000bare000refresh'}`)).toBe(
      'bootstrap -Env refresh_token=<redacted>'
    )
    expect(redactSecrets('password=FAKEfake000bare000password')).toBe('password=<redacted>')
    // Ordinary diagnostics text with an ambiguous name stays readable.
    expect(redactSecrets('Setup exited with code=1')).toBe('Setup exited with code=1')
  })

  it('redacts a quoted session-token field without eating neighbouring fields', () => {
    const json = '{"x-hermes-session-token":"FAKEfake000quoted000session","gateway_state":"running"}'
    const out = redactSecrets(json)
    expect(out).not.toContain('FAKEfake000quoted000session')
    expect(out).toContain('"gateway_state":"running"')
    expect(() => JSON.parse(out)).not.toThrow()
  })

  it('is idempotent for every migrated pattern too', () => {
    for (const raw of Object.values(FAKE_SECRETS)) {
      const once = redactSecrets(raw)
      expect(redactSecrets(once)).toBe(once)
    }
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
