import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertNotLiveHome, liveHermesHome, offlineChannelEnv } from './hermes-shared-home.mjs'
import { withProfile } from './hermes-rest.mjs'

describe('assertNotLiveHome (safety guard)', () => {
  it('refuses the live Hermes home and any path inside it', () => {
    const live = liveHermesHome()
    expect(() => assertNotLiveHome(live)).toThrow(/live Hermes home/)
    expect(() => assertNotLiveHome(path.join(live, 'sessions'))).toThrow(/live Hermes home/)
  })

  it('accepts an isolated temp home outside the live profile', () => {
    const isolated = path.join(process.env.TEMP || '/tmp', 'hermes-e2e-home-xyz')
    expect(assertNotLiveHome(isolated)).toBe(path.resolve(isolated))
  })
})

describe('offlineChannelEnv', () => {
  it('disables every external channel so serve stays offline', () => {
    const env = offlineChannelEnv()
    for (const key of ['WHATSAPP_ENABLED', 'TELEGRAM_ENABLED', 'EMAIL_ENABLED', 'SLACK_ENABLED']) {
      expect(env[key]).toBe('0')
    }
    expect(env.HERMES_DESKTOP).toBe('1')
  })
})

describe('withProfile', () => {
  it('appends the default profile with the right separator', () => {
    expect(withProfile('/api/skills')).toBe('/api/skills?profile=default')
    expect(withProfile('/api/cron/jobs?x=1')).toBe('/api/cron/jobs?x=1&profile=default')
  })
})
