import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeChat } from './whatsapp-policy.cjs'

// The ONE WhatsApp/WhatsApp-Cloud principal normalizer (normalizeChat, exported
// from whatsapp-policy.cjs) feeds three independent consumers:
//   * whatsapp-policy.cjs            — the plugin allow-list (reply_chats)
//   * whatsapp-policy-sync.cjs       — the native platform env (WHATSAPP_ALLOWED_USERS)
//   * whatsapp-monitoring-config.cjs — channel_overrides / config allow_from
// Before this consolidation each had its own hand-copied regex chain; a silent
// divergence between them is a policy-boundary mismatch (one store allows a
// principal the other blocks). This file asserts they agree on a
// representative set of odd real-world formats.
const PRINCIPAL_CASES: Array<{ raw: string; expected: string }> = [
  { raw: '+972501234567', expected: '972501234567' },
  { raw: '972501234567', expected: '972501234567' },
  { raw: '972501234567@s.whatsapp.net', expected: '972501234567' },
  { raw: 'whatsapp:+972501234567', expected: '972501234567' },
  { raw: 'whatsapp_cloud:972501234567@lid', expected: '972501234567' },
  { raw: '  +1 (555) 123-4567  ', expected: '15551234567' }
]

describe('normalizeChat — the single WhatsApp principal normalizer', () => {
  it('normalizes odd real-world formats to a consistent digits-only principal', () => {
    for (const { raw, expected } of PRINCIPAL_CASES) {
      expect(normalizeChat(raw)).toBe(expected)
    }
  })

  it('leaves a non-numeric id (e.g. an unrecognized handle) lower-cased but otherwise intact', () => {
    expect(normalizeChat('SomeHandle')).toBe('somehandle')
  })
})

describe('cross-consumer agreement — plugin allow-list, native env, and monitoring config', () => {
  let tmp: string
  let prevHome: string | undefined

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-policy-agree-'))
    prevHome = process.env.HERMES_BUSINESS_HOME
    process.env.HERMES_BUSINESS_HOME = tmp
    vi.resetModules()
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HERMES_BUSINESS_HOME
    else process.env.HERMES_BUSINESS_HOME = prevHome
    fs.rmSync(tmp, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('whatsapp-policy (reply_chats), whatsapp-policy-sync (native env WHATSAPP_ALLOWED_USERS), and whatsapp-monitoring-config (applyMonitoringConfig allow_from) all normalize the same DM sources identically', async () => {
    const { normalizePolicy } = await import('./whatsapp-policy.cjs')
    const { nativeUpdateForPolicy } = await import('./whatsapp-policy-sync.cjs')
    const { applyMonitoringConfig } = await import('./whatsapp-monitoring-config.cjs')

    const sources = PRINCIPAL_CASES.map((c, i) => ({
      id: c.raw,
      name: `contact-${i}`,
      type: 'dm' as const,
      platform: 'whatsapp' as const
    }))

    const policy = (normalizePolicy as (candidate: unknown) => any)({ mode: 'selected_chats', sources })
    const expected = [...new Set(PRINCIPAL_CASES.map(c => c.expected))].sort()

    // 1) the plugin allow-list (reply_chats), normalized inside whatsapp-policy.cjs.
    expect([...new Set(policy.reply_chats)].sort()).toEqual(expected)

    // 2) the native platform env allow-list, normalized by whatsapp-policy-sync.cjs
    // (nativeUpdateForPolicy is its exported surface; WHATSAPP_ALLOWED_USERS is the
    // comma-joined principal list it feeds into the native runtime).
    const { env } = (nativeUpdateForPolicy as (p: unknown) => { env: Record<string, string> })(policy)
    expect([...new Set(env.WHATSAPP_ALLOWED_USERS.split(','))].sort()).toEqual(expected)

    // 3) channel_overrides / config allow_from, normalized inside
    // whatsapp-monitoring-config.cjs's applyMonitoringConfig via the real PUT payload.
    const putCalls: Array<{ endpoint: string; opts: any }> = []
    const api = async (endpoint: string, opts?: any) => {
      if (opts?.method === 'PUT') putCalls.push({ endpoint, opts })
      return {}
    }
    await (applyMonitoringConfig as (policy: unknown, previous: unknown, api: unknown) => Promise<void>)(
      policy,
      { sources: [] },
      api
    )
    expect(putCalls).toHaveLength(1)
    const patch = putCalls[0].opts.body.config
    expect([...new Set(patch.platforms.whatsapp.allow_from)].sort()).toEqual(expected)
  })
})
