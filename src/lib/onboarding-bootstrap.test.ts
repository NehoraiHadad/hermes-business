import { describe, expect, it } from 'vitest'
import {
  BOOTSTRAP_COMMAND,
  WELCOME_COMMAND,
  buildBootstrapPrompt,
  buildModelSnapshot
} from '../../shared/onboarding-bootstrap.js'
import { EMPTY_ONBOARDING } from '../../shared/onboarding-contract.js'

describe('canonical bootstrap payload', () => {
  it('names both first-run Skills: the role-sensing welcome and the business onboarding', () => {
    expect(WELCOME_COMMAND).toBe('tachles-welcome')
    expect(BOOTSTRAP_COMMAND).toBe('business-bootstrap')
  })

  it('stays role-neutral: business-context is conditional, not an unconditional step', () => {
    const prompt = buildBootstrapPrompt({})
    expect(prompt).toContain('אם מדובר בעבודה עסקית — תחזק גם Skill בשם business-context')
  })

  it('is one dispatch argument shared by React and plugin: snapshot and guardrails', () => {
    const snapshot = { provider_ready: false, provider_state: 'runtime_only' }
    const prompt = buildBootstrapPrompt({ snapshot })
    expect(prompt).not.toContain('/tachles-welcome')
    expect(prompt).not.toContain('/business-bootstrap')
    expect(prompt).toContain('WRAPPER_VERIFIED_SNAPSHOT=' + JSON.stringify(snapshot))
    // Product intent enforced in the single source of truth:
    expect(prompt).toContain('שאל שאלה אחת קצרה בכל פעם') // one concise question at a time
    expect(prompt).toContain('אין לבצע פעולה חיצונית ואין לבקש secret בצ׳אט.') // confirm/no secrets
    expect(prompt).toContain('אל תסמן סיום') // no false completion, resumable
    expect(prompt).toContain('Never run hermes doctor') // bounded inspection (plugin parity)
  })

  it('embeds normalized answers only when supplied (partial onboarding is fine)', () => {
    const withData = buildBootstrapPrompt({ data: { name: 'דנה', businessName: 'סטודיו אור' } })
    expect(withData).toContain('"businessName": "סטודיו אור"')
    expect(withData).toContain('"userName": "דנה"') // migrated from legacy `name`
    expect(buildBootstrapPrompt({})).not.toContain('"businessName"')
  })

  it('plugin model snapshot is honest: configured-not-proven-usable, never a false usable', () => {
    // A selected model is 'configured' (not 'usable'); the live agent session proves usability.
    expect(buildModelSnapshot({ model: 'gpt-test' })).toMatchObject({ provider_ready: false, provider_state: 'configured' })
    expect(buildModelSnapshot({ model: null })).toMatchObject({ provider_ready: false, provider_state: 'unavailable' })
  })

  it('empty-default answers round-trip without inventing data', () => {
    const prompt = buildBootstrapPrompt({ data: EMPTY_ONBOARDING })
    expect(prompt).toContain('"userName": ""')
  })
})
