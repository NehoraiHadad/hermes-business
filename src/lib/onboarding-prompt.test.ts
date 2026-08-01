import { describe, expect, it } from 'vitest'
import { EMPTY_ONBOARDING } from '../constants'
import { buildOnboardingPrompt } from './onboarding-prompt'

describe('onboarding handoff prompt', () => {
  it('builds the dispatch argument with the verified snapshot and answers', () => {
    const data = { ...EMPTY_ONBOARDING, userName: 'דנה', businessName: 'סטודיו אור' }
    const snapshot = { provider_ready: true, scheduled_tasks: 2 }
    const prompt = buildOnboardingPrompt(data, snapshot)

    expect(prompt).not.toContain('/business-bootstrap')
    expect(prompt).toContain('WRAPPER_VERIFIED_SNAPSHOT=' + JSON.stringify(snapshot))
    expect(prompt).toContain('"businessName": "סטודיו אור"')
    expect(prompt).toContain('אין לבצע פעולה חיצונית ואין לבקש secret בצ׳אט.')
  })
})
