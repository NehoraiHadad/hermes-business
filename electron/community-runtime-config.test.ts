import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  assertAllowedCommunityApiEndpoint,
  COMMUNITY_ACTIVATION_FILE,
  communityLayout,
  inspectCommunityInstall,
  parseCommunityActivation
} from './community-runtime-config.cjs'
import {
  COMMUNITY_ACTIVATION as GENERATED_COMMUNITY_ACTIVATION,
  COMMUNITY_ACTIVATION_FILE as GENERATED_COMMUNITY_ACTIVATION_FILE
} from '../scripts/lib/community/generate.mjs'

describe('community runtime configuration', () => {
  it('keeps the patched engine and state outside the official Hermes home', () => {
    const layout = communityLayout({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' })!
    expect(layout.root).toBe(path.join('C:\\Users\\u\\AppData\\Local', 'TachlesCommunity'))
    expect(layout.home).toBe(path.join(layout.root, 'home'))
    expect(layout.root.toLowerCase()).not.toContain(`${path.sep}hermes${path.sep}`)
  })

  it('requires the contract, pinned engine interpreter, generated home and explicit activation', () => {
    const present = new Set<string>()
    const env = { LOCALAPPDATA: 'C:\\Local' }
    const first = inspectCommunityInstall({ env, exists: file => present.has(file) })
    expect(first.provisioned).toBe(false)
    for (const file of [first.layout!.contract, first.layout!.python, path.join(first.layout!.home, 'config.yaml')]) {
      present.add(file)
    }
    const stale = inspectCommunityInstall({ env, exists: file => present.has(file) })
    expect(stale).toMatchObject({ provisioned: true, active: false, target: 'business' })
    present.add(first.layout!.activation)
    expect(inspectCommunityInstall({
      env,
      exists: file => present.has(file),
      readFile: () => JSON.stringify({ schema: 1, mode: 'community', active: true })
    })).toMatchObject({ provisioned: true, active: true, target: 'community', reason: null })
  })

  it('fails safely to business for stale, malformed or explicitly inactive markers', () => {
    expect(COMMUNITY_ACTIVATION_FILE).toBe('.tachles-community.json')
    expect(COMMUNITY_ACTIVATION_FILE).toBe(GENERATED_COMMUNITY_ACTIVATION_FILE)
    expect(parseCommunityActivation(JSON.stringify(GENERATED_COMMUNITY_ACTIVATION)))
      .toEqual({ active: true, reason: null })
    expect(parseCommunityActivation('{')).toMatchObject({ active: false })
    expect(parseCommunityActivation(JSON.stringify({ schema: 2, mode: 'community', active: true })))
      .toMatchObject({ active: false })
    expect(parseCommunityActivation(JSON.stringify({ schema: 1, mode: 'community', active: false })))
      .toMatchObject({ active: false, reason: expect.stringContaining('inactive') })
  })

  it('allows only guided WhatsApp/provider onboarding and model selection', () => {
    expect(assertAllowedCommunityApiEndpoint('/api/messaging/whatsapp/onboarding/start')).toContain('onboarding')
    expect(assertAllowedCommunityApiEndpoint('/api/messaging/whatsapp/onboarding/abc_123')).toContain('abc_123')
    expect(assertAllowedCommunityApiEndpoint('/api/messaging/whatsapp/onboarding/abc-123/apply')).toContain('/apply')
    expect(assertAllowedCommunityApiEndpoint('/api/providers/oauth?profile=default')).toContain('/oauth')
    expect(assertAllowedCommunityApiEndpoint('/api/providers/oauth/openai-codex/start?profile=default')).toContain('/start')
    expect(assertAllowedCommunityApiEndpoint('/api/providers/oauth/openai-codex/poll/s1?profile=default')).toContain('/poll')
    expect(assertAllowedCommunityApiEndpoint('/api/providers/oauth/sessions/s1?profile=default')).toContain('/sessions')
    expect(assertAllowedCommunityApiEndpoint('/api/model/recommended-default?provider=openai-codex')).toContain('recommended')
    expect(assertAllowedCommunityApiEndpoint('/api/model/set')).toContain('/set')
    expect(() => assertAllowedCommunityApiEndpoint('/api/env')).toThrow(/not allowed/)
    expect(() => assertAllowedCommunityApiEndpoint('/api/providers/validate')).toThrow(/not allowed/)
    expect(() => assertAllowedCommunityApiEndpoint('/api/providers/oauth?profile=admin')).toThrow(/not allowed/)
    expect(() => assertAllowedCommunityApiEndpoint('/api/messaging/whatsapp/onboarding/a?profile=x')).toThrow(/not allowed/)
  })
})
