import { describe, expect, it } from 'vitest'
import { resolveProviderReadiness } from './provider-readiness'

describe('provider readiness', () => {
  it('prefers a live Hermes OAuth session', () => {
    expect(
      resolveProviderReadiness(
        [{ id: 'openai-codex', name: 'OpenAI Codex', flow: 'device_code', status: { logged_in: true } }],
        {}
      )
    // Display label is the short mapped brand name, never the raw catalog string.
    ).toEqual({ connected: true, label: 'Codex' })
  })

  it('recognizes API keys only from Hermes redacted metadata', () => {
    expect(resolveProviderReadiness([], { ANTHROPIC_API_KEY: { is_set: true } })).toEqual({
      connected: true,
      label: 'Anthropic'
    })
    expect(resolveProviderReadiness([], {})).toEqual({ connected: false, label: 'לא מחובר' })
  })
})
