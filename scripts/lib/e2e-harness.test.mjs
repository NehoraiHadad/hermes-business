import { describe, expect, it } from 'vitest'
import { pollUntil, safeJson, sanitize, withRetry } from './e2e-harness.mjs'
import { flattenSkillNames } from './hermes-live.mjs'

describe('sanitize', () => {
  it('redacts token/ticket/code query parameters', () => {
    expect(sanitize('ws://h/api/ws?token=abcd1234EFGH&x=1')).toBe('ws://h/api/ws?token=<redacted>&x=1')
    expect(sanitize('/cb?code=secretauthcode&state=z')).toBe('/cb?code=<redacted>&state=z')
    expect(sanitize('/x?ticket=TKT-9911')).toBe('/x?ticket=<redacted>')
  })

  it('redacts known API-key and bot-token shapes', () => {
    expect(sanitize('key sk-ABCDEFGHIJKL0123 done')).toBe('key <redacted> done')
    expect(sanitize('AIzaSyABCDEFGHIJKLMNOPQRSTUVWX1234567')).toBe('<redacted>')
    expect(sanitize('bot 1234567890:AAExampleTelegramToken123')).toBe('bot <redacted>')
  })

  it('redacts Authorization headers and JSON-ish secret fields', () => {
    expect(sanitize('Authorization: Bearer eyJhbGciOiJ.payload.sig')).toBe('Authorization: Bearer <redacted>')
    expect(sanitize('{"api_key":"live_supersecretvalue"}')).toBe('{"api_key":"<redacted>"}')
  })

  it('is idempotent and leaves clean text untouched', () => {
    const clean = 'POC E2E — shared session 2026-07-31'
    expect(sanitize(clean)).toBe(clean)
    expect(sanitize(sanitize('?token=abcd1234EFGH'))).toBe('?token=<redacted>')
  })

  it('does not touch benign markers, timestamps or geometry in report JSON', () => {
    const payload = {
      mini: { marker: 'INSTALLED_MINI_E2E_OK_1753900000000', windowDetails: { bounds: { width: 390 } } },
      shared_session: { title: 'POC E2E — shared session 1753900000000', source: 'desktop' },
      integrations: { taskTruth: { error_code: null } }
    }
    expect(JSON.parse(safeJson(payload))).toEqual(payload)
  })
})

describe('pollUntil', () => {
  it('resolves with the first truthy value', async () => {
    let n = 0
    const value = await pollUntil(() => (++n >= 3 ? `done-${n}` : false), { intervalMs: 1, timeoutMs: 1_000 })
    expect(value).toBe('done-3')
  })

  it('throws a descriptive error on timeout', async () => {
    await expect(pollUntil(() => false, { intervalMs: 1, timeoutMs: 20, message: 'the widget' })).rejects.toThrow(
      /Timed out waiting for the widget/
    )
  })
})

describe('withRetry', () => {
  it('retries until success and reports attempts', async () => {
    const seen = []
    const value = await withRetry(
      attempt => {
        if (attempt < 2) throw new Error('nope')
        return 'ok'
      },
      { attempts: 3, delayMs: 1, onError: (_error, attempt) => seen.push(attempt) }
    )
    expect(value).toBe('ok')
    expect(seen).toEqual([1])
  })

  it('rethrows the last error after exhausting attempts', async () => {
    await expect(
      withRetry(
        () => {
          throw new Error('always')
        },
        { attempts: 2, delayMs: 1 }
      )
    ).rejects.toThrow('always')
  })
})

describe('flattenSkillNames', () => {
  it('flattens arrays, nested objects and strings into a distinct-ready list', () => {
    const input = {
      builtin: [{ name: 'business-bootstrap' }, { name: 'poc-weekly-lead-summary' }],
      custom: ['ad-hoc'],
      grouped: { nested: [{ name: 'deep-skill' }] }
    }
    expect(new Set(flattenSkillNames(input))).toEqual(
      new Set(['business-bootstrap', 'poc-weekly-lead-summary', 'ad-hoc', 'deep-skill'])
    )
  })
})
