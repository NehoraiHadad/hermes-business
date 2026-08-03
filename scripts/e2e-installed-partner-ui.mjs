// Safe installed/runtime probe for Business Partner mode + the Hermes-native
// sandbox. It NEVER starts Docker and never leaves a container behind: it only
// requests the Docker tier and asserts the honest fail-closed-to-guard result
// while Docker is stopped.
//
// Partner settings are LIVE user state, so they are journalled to disk before the
// first mutation (./lib/live-restore-journal.mjs). A crash mid-probe no longer
// leaves the profile in partner/docker mode: the next run restores the journalled
// settings before it touches anything, and a restore that fails or does not read
// back equal is a loud, non-zero-exit failure.

import { withLiveRestore } from './lib/live-restore-journal.mjs'
import { withProbeApp } from './lib/probe-app.mjs'
import { assertSafeInstalledE2E } from './lib/e2e-safety.mjs'

const safety = assertSafeInstalledE2E()
// A journal belongs to the profile it was captured from: an isolated QA home, or
// the operator's live profile under the disposable-host hatch.
const scope = safety.home || 'live-profile'

const PARTNER_FIELDS = ['mode', 'sandbox', 'network', 'checkins', 'checkinCadence', 'roots']

await withProbeApp({ prefix: 'hermes-business-partner-ui' }, async ({ page }) => {
  const summary = await withLiveRestore(
    {
      key: 'partner-settings',
      label: 'the live Business Partner settings',
      scope,
      capture: async () => {
        const state = await page.evaluate(() => window.hermesDesktop.getPartnerState())
        return Object.fromEntries(PARTNER_FIELDS.map(field => [field, state[field]]))
      },
      restore: settings => page.evaluate(value => window.hermesDesktop.applyPartnerMode(value), settings)
    },
    async () => {
      await page.locator('.main-nav__item').filter({ hasText: 'תמיכה' }).click()
      const panel = page.locator('.partner-panel')
      await panel.getByRole('heading', { name: /שותף עסקי וארגז חול/ }).waitFor({ state: 'visible', timeout: 30_000 })

      // Turn on partner mode and confirm the native personality actually flipped.
      await panel.getByRole('radio', { name: /שותף עסקי/ }).click()
      await page.waitForFunction(async () => (await window.hermesDesktop.getPartnerState()).mode === 'partner', {
        timeout: 30_000
      })
      const partnerState = await page.evaluate(() => window.hermesDesktop.getPartnerState())
      if (!partnerState.personalityActive) throw new Error('Partner personality did not activate')

      // Request Docker while it is stopped: must fail closed to local guard, never
      // pretend isolation, and never start Docker.
      await panel.getByRole('radio', { name: /בידוד Docker/ }).click()
      await page.waitForFunction(async () => (await window.hermesDesktop.getPartnerState()).sandbox === 'docker', {
        timeout: 30_000
      })
      const dockerRequested = await page.evaluate(() => window.hermesDesktop.getPartnerState())
      const plan = dockerRequested.plan
      if (plan.effective !== 'guard' || !plan.degraded || plan.isolation || dockerRequested.backend === 'docker') {
        throw new Error(`Docker was not fail-closed: ${JSON.stringify(plan)}`)
      }

      return {
        partnerActivated: partnerState.personalityActive,
        dockerFailedClosed: plan.effective === 'guard' && plan.degraded === true,
        backend: dockerRequested.backend,
        dockerStatus: dockerRequested.docker.status,
        approvalSemantics: plan.approvalSemantics
      }
    }
  )

  console.log(
    JSON.stringify({
      ok: true,
      ...summary.result,
      livePartnerSettingsRestored: true,
      recoveredCrashedRestore: summary.recovered
    })
  )
})
