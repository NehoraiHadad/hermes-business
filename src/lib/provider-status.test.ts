import { describe, expect, it } from 'vitest'
import { resolveModelReadiness, resolveProviderStatus } from './provider-readiness'
import { buildVerifiedSnapshot } from '../../shared/onboarding-bootstrap.js'

const RUNNING = { running: true, version: '0.19.0' }

describe('provider status (honest readiness)', () => {
  it('regression: runtime running with NO provider is not ready', () => {
    const status = resolveProviderStatus({ runtime: RUNNING, oauthProviders: [], env: {} })
    expect(status.provider_ready).toBe(false)
    expect(status.runtime_running).toBe(true)
    expect(status.provider_state).toBe('runtime_only')
  })

  it('is usable via a live OAuth session while the runtime runs', () => {
    const status = resolveProviderStatus({
      runtime: RUNNING,
      oauthProviders: [{ name: 'OpenAI Codex', status: { logged_in: true } }],
      env: {}
    })
    expect(status).toMatchObject({ provider_ready: true, provider_state: 'usable', provider_label: 'OpenAI Codex' })
  })

  it('never leaks the engine catalog\'s English status doctrine into the label', () => {
    // The engine's claude-code entry is literally named with a usage-credits
    // warning (hermes_cli/web_server.py catalog) — the user-facing label must
    // be the short brand name, never that sentence.
    const status = resolveProviderStatus({
      runtime: RUNNING,
      oauthProviders: [
        {
          id: 'claude-code',
          name: 'Anthropic OAuth: Required Extra Usage Credits to Use Subscription',
          status: { logged_in: true }
        }
      ],
      env: {}
    })
    expect(status.provider_label).toBe('Claude')
    expect(status.provider_label).not.toMatch(/Required Extra Usage Credits/)
  })

  it('a Hermes-store login outranks ambient machine-scoped credential spillover', () => {
    // Live repro (2026-08-18): an OpenAI-subscription machine (auth.json
    // openai-codex, auth_mode=chatgpt) ALSO carries Claude Code's
    // ~/.claude/.credentials.json, which the engine surfaces as a logged-in
    // claude-code row. The card must name the provider the user connected
    // through Hermes, not the ambient spillover — regardless of catalog order.
    const status = resolveProviderStatus({
      runtime: RUNNING,
      oauthProviders: [
        { id: 'claude-code', name: 'Anthropic OAuth: Required Extra Usage Credits to Use Subscription', status: { logged_in: true } },
        { id: 'openai-codex', name: 'OpenAI Codex (ChatGPT subscription)', status: { logged_in: true } }
      ],
      env: {}
    })
    expect(status.provider_label).toBe('Codex')
  })

  it('ambient spillover alone still proves a usable connection, with a short label', () => {
    const status = resolveProviderStatus({
      runtime: RUNNING,
      oauthProviders: [
        { id: 'claude-code', name: 'Anthropic OAuth: Required Extra Usage Credits to Use Subscription', status: { logged_in: true } }
      ],
      env: {}
    })
    expect(status).toMatchObject({ provider_ready: true, provider_state: 'usable', provider_label: 'Claude' })
  })

  it('an unknown verbose catalog name degrades to a bounded brand prefix or the generic label', () => {
    const prefix = resolveProviderStatus({
      runtime: RUNNING,
      oauthProviders: [{ id: 'future-x', name: 'FutureAI: does many things (beta)', status: { logged_in: true } }],
      env: {}
    })
    expect(prefix.provider_label).toBe('FutureAI')
    const generic = resolveProviderStatus({
      runtime: RUNNING,
      oauthProviders: [
        { id: 'future-y', name: 'An extremely long provider description without any separator at all', status: { logged_in: true } }
      ],
      env: {}
    })
    expect(generic.provider_label).toBe('ספק AI')
  })

  it('recognizes each supported API-key readiness source from redacted env', () => {
    for (const [key, label] of [
      ['OPENROUTER_API_KEY', 'OpenRouter'],
      ['ANTHROPIC_API_KEY', 'Anthropic'],
      ['GEMINI_API_KEY', 'Gemini'],
      ['OPENAI_API_KEY', 'OpenAI']
    ]) {
      const status = resolveProviderStatus({ runtime: RUNNING, oauthProviders: [], env: { [key]: { is_set: true } } })
      expect(status).toMatchObject({ provider_ready: true, provider_state: 'usable', provider_label: label })
    }
  })

  it('configured-but-not-running reports configured, not ready', () => {
    const status = resolveProviderStatus({
      runtime: { running: false },
      oauthProviders: [],
      env: { OPENAI_API_KEY: { is_set: true } }
    })
    expect(status).toMatchObject({ provider_ready: false, provider_configured: true, provider_state: 'configured' })
  })

  it('positive OAuth proof stands even when the env source failed (null)', () => {
    const status = resolveProviderStatus({
      runtime: RUNNING,
      oauthProviders: [{ name: 'OpenAI Codex', status: { logged_in: true } }],
      env: null
    })
    expect(status).toMatchObject({ provider_ready: true, provider_state: 'usable', provider_label: 'OpenAI Codex' })
    expect(status.provider_sources).toEqual({ oauth: 'positive', env: 'unknown' })
  })

  it('positive env proof stands even when the OAuth source failed (null)', () => {
    const status = resolveProviderStatus({ runtime: RUNNING, oauthProviders: null, env: { GEMINI_API_KEY: { is_set: true } } })
    expect(status).toMatchObject({ provider_ready: true, provider_state: 'usable', provider_label: 'Gemini' })
    expect(status.provider_sources).toEqual({ oauth: 'unknown', env: 'positive' })
  })

  it('all sources inspected & negative → unavailable when not running (not unknown)', () => {
    const status = resolveProviderStatus({ runtime: { running: false }, oauthProviders: [], env: {} })
    expect(status).toMatchObject({ provider_ready: false, provider_state: 'unavailable', provider_configured: false })
  })

  it('no positive proof + any failed source → unknown, never a false unavailable', () => {
    // env failed (null), oauth inspected-empty: absence is unproven → unknown.
    const oneFailed = resolveProviderStatus({ runtime: RUNNING, oauthProviders: [], env: null })
    expect(oneFailed).toMatchObject({ provider_state: 'unknown', provider_ready: false })
    const bothFailed = resolveProviderStatus({ runtime: RUNNING, oauthProviders: null, env: null })
    expect(bothFailed).toMatchObject({ provider_state: 'unknown', provider_ready: false })
  })

  it('fails closed on error or un-inspected inputs (unknown, never ready)', () => {
    expect(resolveProviderStatus({ runtime: RUNNING, error: 'boom' })).toMatchObject({
      provider_ready: false,
      provider_state: 'unknown'
    })
    expect(resolveProviderStatus({ runtime: RUNNING })).toMatchObject({
      provider_ready: false,
      provider_state: 'unknown'
    })
  })

  it('treats an incompatible runtime as degraded/unknown even when configured', () => {
    const status = resolveProviderStatus({
      runtime: { running: true, compatible: false },
      oauthProviders: [{ name: 'OpenAI Codex', status: { logged_in: true } }],
      env: {}
    })
    expect(status).toMatchObject({ provider_ready: false, provider_state: 'unknown' })
  })

  it('plugin model readiness is configured-but-not-proven-usable (agent proves usability live)', () => {
    // A selected model proves CONFIGURED, not that the credential round-trips; the
    // wrapper never claims 'usable' it did not observe, so provider_ready stays false.
    expect(resolveModelReadiness('gpt-test')).toMatchObject({
      provider_ready: false,
      provider_state: 'configured',
      provider_configured: true,
      provider_label: 'gpt-test'
    })
    expect(resolveModelReadiness(null)).toMatchObject({
      provider_ready: false,
      provider_state: 'unavailable',
      provider_configured: false
    })
  })

  it('snapshot provider_ready follows the honest status, not runtime uptime', () => {
    const notReady = resolveProviderStatus({ runtime: RUNNING, oauthProviders: [], env: {} })
    const snapshot = buildVerifiedSnapshot({ runtime: RUNNING, providerStatus: notReady })
    expect(snapshot.provider_ready).toBe(false)
    expect(snapshot.runtime_running).toBe(true)
  })
})
