import { describe, expect, it, vi } from 'vitest'
import { codexUsageUrl, probeCodexGrant, usageProvesUsableGrant } from './codex-probe.cjs'
// The token secret boundary + JWT structural gate live in a dedicated module now.
import { decodeJwtClaims, isDecodableJwt, readCodexAccessToken } from './codex-token-store.cjs'

// A real Codex access token is a JWT (exactly two dots) carrying at least one claim. Build a
// minimal, structurally-valid one so the JWT-first gate passes and the ChatGPT-Account-Id
// header can be derived. Never a real credential.
function fakeJwt(accountId?: string) {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const claims: Record<string, unknown> = { exp: 9999999999 }
  if (accountId) claims['https://api.openai.com/auth'] = { chatgpt_account_id: accountId }
  return `${b64({ alg: 'none' })}.${b64(claims)}.sig`
}

// The ONLY 200 body shape that proves a usable grant: an object with a `rate_limit` whose
// windows are below 100% used (mirrors official _probe_codex_quota_restored).
function usableUsageBody(usedPercent = 12) {
  return { rate_limit: { primary_window: { used_percent: usedPercent } } }
}

// `body` (optional) is returned from resp.json(); pass `undefined` to model a response with
// no JSON body, or a thrower to model a malformed 200. `jsonThrows` forces resp.json() to reject.
function fakeFetch(status: number, body?: unknown, jsonThrows = false) {
  const seen: Array<{ url: string; headers: Record<string, string>; method?: string }> = []
  const fetchImpl = vi.fn(async (url: string, init: { headers: Record<string, string>; method?: string }) => {
    seen.push({ url, headers: init.headers, method: init.method })
    return {
      status,
      json: async () => {
        if (jsonThrows) throw new Error('malformed body')
        return body
      }
    }
  })
  return { fetchImpl, seen }
}

describe('codex-probe — usage-endpoint URL mirrors the Codex CLI PathStyle split', () => {
  it('uses /wham/usage for the default ChatGPT backend-api base and strips a trailing /codex', () => {
    expect(codexUsageUrl(undefined)).toBe('https://chatgpt.com/backend-api/wham/usage')
    expect(codexUsageUrl('https://chatgpt.com/backend-api/codex/')).toBe('https://chatgpt.com/backend-api/wham/usage')
  })

  it('uses /api/codex/usage for a non-backend-api base', () => {
    expect(codexUsageUrl('https://example.test')).toBe('https://example.test/api/codex/usage')
  })
})

describe('codex-probe — read-only access-token lookup from auth.json', () => {
  const read = (store: unknown) => readCodexAccessToken({ authPath: 'x', readFile: () => JSON.stringify(store) })

  it('prefers the singleton providers.openai-codex token', () => {
    expect(read({ providers: { 'openai-codex': { tokens: { access_token: 'jwt-singleton' } } } })).toBe('jwt-singleton')
  })

  it('falls back to the first live credential-pool entry, skipping dead ones', () => {
    const store = {
      credential_pool: {
        'openai-codex': [
          { access_token: 'dead-tok', last_status: 'dead' },
          { access_token: 'pool-tok', last_status: 'exhausted' }
        ]
      }
    }
    expect(read(store)).toBe('pool-tok')
  })

  it('returns empty string on a missing/corrupt store (⇒ probe fails closed)', () => {
    expect(readCodexAccessToken({ authPath: 'x', readFile: () => { throw new Error('ENOENT') } })).toBe('')
    expect(read({ providers: {} })).toBe('')
  })
})

describe('codex-probe — JWT structural gate mirrors official _decode_jwt_claims', () => {
  it('decodeJwtClaims requires exactly two dots and a JSON-object payload', () => {
    expect(decodeJwtClaims(fakeJwt('acct-1'))).toMatchObject({
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct-1' }
    })
    // Wrong segment count, non-string, and non-object payloads all yield {}.
    expect(decodeJwtClaims('a.b')).toEqual({})
    expect(decodeJwtClaims('a.b.c.d')).toEqual({})
    expect(decodeJwtClaims(undefined as unknown as string)).toEqual({})
    const arrayPayload = `x.${Buffer.from('[1,2]').toString('base64url')}.y`
    expect(decodeJwtClaims(arrayPayload)).toEqual({})
  })

  it('isDecodableJwt is false for non-JWT and empty-claims tokens, true for a real one', () => {
    expect(isDecodableJwt('not-a-jwt')).toBe(false)
    expect(isDecodableJwt('')).toBe(false)
    const emptyClaims = `x.${Buffer.from('{}').toString('base64url')}.y`
    expect(isDecodableJwt(emptyClaims)).toBe(false)
    expect(isDecodableJwt(fakeJwt())).toBe(true)
  })

  it('decodeJwtClaims never throws on malformed input', () => {
    expect(decodeJwtClaims('not-a-jwt')).toEqual({})
    expect(decodeJwtClaims('')).toEqual({})
  })
})

describe('codex-probe — usageProvesUsableGrant only accepts a sub-100% rate-limit shape', () => {
  it('accepts a window below 100% used', () => {
    expect(usageProvesUsableGrant(usableUsageBody(0))).toBe(true)
    expect(usageProvesUsableGrant(usableUsageBody(99.9))).toBe(true)
  })

  it('rejects a fully-used window, a missing/unexpected shape, and non-numeric percents', () => {
    expect(usageProvesUsableGrant(usableUsageBody(100))).toBe(false)
    expect(usageProvesUsableGrant({ rate_limit: { secondary_window: { used_percent: 100 } } })).toBe(false)
    expect(usageProvesUsableGrant({ rate_limit: {} })).toBe(false)
    expect(usageProvesUsableGrant({ unexpected: true })).toBe(false)
    expect(usageProvesUsableGrant(null)).toBe(false)
    expect(usageProvesUsableGrant({ rate_limit: { primary_window: { used_percent: 'x' } } })).toBe(false)
  })

  it('uses the WORST (highest) window across primary and secondary', () => {
    expect(usageProvesUsableGrant({
      rate_limit: { primary_window: { used_percent: 10 }, secondary_window: { used_percent: 100 } }
    })).toBe(false)
  })
})

describe('codex-probe — real, non-destructive, non-billable liveness probe', () => {
  it('GETs /usage with a Bearer token (never in the URL) and accepts a usable 200', async () => {
    const token = fakeJwt()
    const { fetchImpl, seen } = fakeFetch(200, usableUsageBody())
    const res = await probeCodexGrant({ fetchImpl, readToken: () => token, baseUrl: 'https://example.test' })
    expect(res).toEqual({ ok: true, reachable: true })
    expect(seen[0].url).toBe('https://example.test/api/codex/usage')
    expect(seen[0].headers.authorization).toBe(`Bearer ${token}`)
    expect(seen[0].url).not.toContain(token)
    // Uses a GET — no token rotation, no content generation.
    expect(seen[0].method).toBe('GET')
  })

  it('sends the ChatGPT-Account-Id derived from the JWT when present', async () => {
    const { fetchImpl, seen } = fakeFetch(200, usableUsageBody())
    await probeCodexGrant({ fetchImpl, readToken: () => fakeJwt('acct-123') })
    expect(seen[0].headers['chatgpt-account-id']).toBe('acct-123')
  })

  it('a non-JWT token is REFUSED before any network call — reachable:false, no secret leak', async () => {
    const { fetchImpl } = fakeFetch(200, usableUsageBody())
    const res = await probeCodexGrant({ fetchImpl, readToken: () => 'not-a-jwt-secret' })
    expect(res).toMatchObject({ ok: false, reachable: false })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(res.message).not.toContain('not-a-jwt-secret')
  })

  it('treats 401/403 as a REVOKED/EXPIRED grant — reachable:true but NOT ok', async () => {
    for (const status of [401, 403]) {
      const { fetchImpl } = fakeFetch(status)
      const res = await probeCodexGrant({ fetchImpl, readToken: () => fakeJwt() })
      expect(res.ok).toBe(false)
      expect(res.reachable).toBe(true)
    }
  })

  it('429 (valid grant, quota EXHAUSTED) is NOT ok and issues no evidence', async () => {
    const { fetchImpl } = fakeFetch(429)
    const res = await probeCodexGrant({ fetchImpl, readToken: () => fakeJwt() })
    expect(res.ok).toBe(false)
    expect(res.reachable).toBe(true)
    expect(res.message).toBeTruthy()
  })

  it('a 200 with a quota-exhausted (100% used) window is reachable but NOT ok', async () => {
    const { fetchImpl } = fakeFetch(200, usableUsageBody(100))
    const res = await probeCodexGrant({ fetchImpl, readToken: () => fakeJwt() })
    expect(res).toMatchObject({ ok: false, reachable: true })
  })

  it('a malformed/unexpected 200 body is reachable but NOT proof', async () => {
    for (const bad of [{ unexpected: true }, undefined]) {
      const { fetchImpl } = fakeFetch(200, bad)
      const res = await probeCodexGrant({ fetchImpl, readToken: () => fakeJwt() })
      expect(res).toMatchObject({ ok: false, reachable: true })
    }
    // A 200 whose body cannot even be parsed as JSON is likewise not proof.
    const { fetchImpl } = fakeFetch(200, undefined, true)
    expect((await probeCodexGrant({ fetchImpl, readToken: () => fakeJwt() }))).toMatchObject({ ok: false, reachable: true })
  })

  it('a network failure is reachable:false — NOT proof, and never surfaces the error', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ENOTFOUND internal-host secret') })
    const res = await probeCodexGrant({ fetchImpl, readToken: () => fakeJwt() })
    expect(res).toMatchObject({ ok: false, reachable: false })
    expect(res.message).not.toContain('secret')
    expect(res.message).not.toContain('ENOTFOUND')
  })

  it('no stored token ⇒ reachable:false, and the endpoint is never called', async () => {
    const { fetchImpl } = fakeFetch(200, usableUsageBody())
    const res = await probeCodexGrant({ fetchImpl, readToken: () => '' })
    expect(res).toMatchObject({ ok: false, reachable: false })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('an unexpected HTTP status is reachable but not accepted', async () => {
    const { fetchImpl } = fakeFetch(500)
    const res = await probeCodexGrant({ fetchImpl, readToken: () => fakeJwt() })
    expect(res).toMatchObject({ ok: false, reachable: true })
  })
})
