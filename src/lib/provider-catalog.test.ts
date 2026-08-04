import { describe, expect, it } from 'vitest'
import { buildProviderOptions, staticFallbackOptions } from './provider-catalog'
import type { OAuthProvider } from './hermes/providers'

// A representative slice of the real Hermes 0.19.1 `/api/providers/oauth`
// catalog — all three flow kinds plus status snapshots.
const CATALOG: OAuthProvider[] = [
  {
    id: 'nous',
    name: 'Nous Portal',
    flow: 'device_code',
    cli_command: 'hermes auth add nous',
    docs_url: 'https://portal.nousresearch.com',
    status: { logged_in: false }
  },
  { id: 'openai-codex', name: 'OpenAI OAuth (ChatGPT)', flow: 'device_code', status: { logged_in: true } },
  {
    id: 'qwen-oauth',
    name: 'Qwen (via Qwen CLI)',
    flow: 'external',
    cli_command: 'hermes auth add qwen-oauth',
    docs_url: 'https://github.com/QwenLM/qwen-code'
  },
  { id: 'minimax-oauth', name: 'MiniMax (OAuth)', flow: 'device_code' },
  { id: 'anthropic', name: 'Anthropic API Key', flow: 'pkce' },
  { id: 'claude-code', name: 'Anthropic OAuth: subscription via Claude Code', flow: 'external' }
]

describe('buildProviderOptions — the full catalog rendered onto exactly three UI shapes', () => {
  it('maps every catalog entry: device_code → device-flow, external → card, codex keeps its dedicated UI', () => {
    const options = buildProviderOptions(CATALOG)
    const ui = Object.fromEntries(options.map(option => [option.id, option.ui]))
    expect(ui['nous']).toBe('device-flow')
    expect(ui['minimax-oauth']).toBe('device-flow')
    expect(ui['openai-codex']).toBe('codex-oauth')
    expect(ui['qwen-oauth']).toBe('external')
    expect(ui['claude-code']).toBe('external')
    // The catalog's anthropic pkce card IS its API-key card — our validated paste path.
    expect(ui['anthropic']).toBe('api-key')
  })

  it('appends the API-key-only providers Hermes does not list, without duplicating listed ones', () => {
    const options = buildProviderOptions(CATALOG)
    const ids = options.map(option => option.id)
    expect(ids).toContain('openrouter')
    expect(ids).toContain('openai')
    expect(ids).toContain('gemini')
    expect(ids.filter(id => id === 'anthropic')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('carries the connect metadata through: cli command, docs url, login snapshot', () => {
    const options = buildProviderOptions(CATALOG)
    const nous = options.find(option => option.id === 'nous')
    expect(nous?.cliCommand).toBe('hermes auth add nous')
    expect(nous?.docsUrl).toBe('https://portal.nousresearch.com')
    expect(nous?.loggedIn).toBe(false)
    expect(options.find(option => option.id === 'openai-codex')?.loggedIn).toBe(true)
  })

  it('renders an UNKNOWN flow as the display-only external card — a fail-safe, never a broken flow', () => {
    const options = buildProviderOptions([
      { id: 'future-provider', name: 'Future Provider', flow: 'quantum_handshake' }
    ])
    expect(options.find(option => option.id === 'future-provider')?.ui).toBe('external')
  })

  it('a non-anthropic pkce provider also falls back to the external card (no wired pkce door)', () => {
    const options = buildProviderOptions([{ id: 'some-pkce', name: 'Some PKCE', flow: 'pkce' }])
    expect(options.find(option => option.id === 'some-pkce')?.ui).toBe('external')
  })

  it('an unknown id keeps the catalog name as its label; known ids get the Hebrew label', () => {
    const options = buildProviderOptions([
      { id: 'brand-new', name: 'Brand New Provider', flow: 'external' },
      ...CATALOG
    ])
    expect(options.find(option => option.id === 'brand-new')?.label).toBe('Brand New Provider')
    expect(options.find(option => option.id === 'nous')?.label).toContain('Nous Portal')
  })

  it('falls back to the static pre-catalog list when the read failed or yielded nothing', () => {
    const fallbackIds = staticFallbackOptions().map(option => option.id)
    expect(buildProviderOptions(null).map(option => option.id)).toEqual(fallbackIds)
    expect(buildProviderOptions(undefined).map(option => option.id)).toEqual(fallbackIds)
    expect(buildProviderOptions([]).map(option => option.id)).toEqual(fallbackIds)
    // Malformed entries only ⇒ also the fallback, never an empty select.
    expect(
      buildProviderOptions([{ id: '', name: 'broken', flow: 'external' } as OAuthProvider]).map(option => option.id)
    ).toEqual(fallbackIds)
    // The fallback always contains the default selection and the key-paste paths.
    expect(fallbackIds).toContain('openai-codex')
    expect(fallbackIds).toContain('anthropic')
  })

  it('drops duplicate catalog ids instead of rendering the same provider twice', () => {
    const options = buildProviderOptions([...CATALOG, { id: 'nous', name: 'Nous again', flow: 'device_code' }])
    expect(options.filter(option => option.id === 'nous')).toHaveLength(1)
  })
})
