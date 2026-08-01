import { describe, expect, it, vi } from 'vitest'
import { probeAnthropic, probeProviderCredential } from './provider-probe.cjs'

// A fake fetch returning a chosen status; records the request so we can assert the
// official Anthropic headers were sent and the key was NOT leaked into the URL.
function fakeFetch(status: number) {
  const seen: Array<{ url: string; headers: Record<string, string> }> = []
  const fetchImpl = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
    seen.push({ url, headers: init.headers })
    return { status }
  })
  return { fetchImpl, seen }
}

describe('provider-probe — real, cost-bounded Anthropic credential probe', () => {
  it('sends x-api-key + anthropic-version to /v1/models and accepts a 200', async () => {
    const { fetchImpl, seen } = fakeFetch(200)
    const res = await probeAnthropic('sk-ant-good', { fetchImpl, baseUrl: 'https://fake.anthropic.test' })
    expect(res).toEqual({ ok: true, reachable: true })
    expect(seen[0].url).toBe('https://fake.anthropic.test/v1/models')
    expect(seen[0].headers['x-api-key']).toBe('sk-ant-good')
    expect(seen[0].headers['anthropic-version']).toBeTruthy()
    // The key must never appear in the URL.
    expect(seen[0].url).not.toContain('sk-ant-good')
  })

  it('treats 401/403 as a REJECTED key (never accept), reachable:true', async () => {
    for (const status of [401, 403]) {
      const { fetchImpl } = fakeFetch(status)
      const res = await probeAnthropic('sk-bad', { fetchImpl })
      expect(res.ok).toBe(false)
      expect(res.reachable).toBe(true)
    }
  })

  it('treats 429 (valid but rate-limited) as accepted', async () => {
    const { fetchImpl } = fakeFetch(429)
    expect(await probeAnthropic('sk', { fetchImpl })).toEqual({ ok: true, reachable: true })
  })

  it('a network failure is reachable:false — NOT proof', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ENOTFOUND')
    })
    const res = await probeAnthropic('sk', { fetchImpl })
    expect(res.ok).toBe(false)
    expect(res.reachable).toBe(false)
  })

  it('an unexpected HTTP status is not accepted', async () => {
    const { fetchImpl } = fakeFetch(500)
    const res = await probeAnthropic('sk', { fetchImpl })
    expect(res.ok).toBe(false)
  })

  it('dispatches anthropic through the probe and refuses unknown providers honestly', async () => {
    const { fetchImpl } = fakeFetch(200)
    const ok = await probeProviderCredential(
      { provider: 'anthropic', apiKey: 'sk-good' },
      { fetchImpl, baseUrl: 'https://fake.anthropic.test' }
    )
    expect(ok).toEqual({ ok: true, reachable: true })
    // A provider Hermes probes itself must not get a fabricated pass here.
    const openai = await probeProviderCredential({ provider: 'openai', apiKey: 'x' })
    expect(openai.ok).toBe(false)
    // An empty key is refused.
    const empty = await probeProviderCredential({ provider: 'anthropic', apiKey: '' })
    expect(empty.ok).toBe(false)
  })
})
