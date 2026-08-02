import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'

// Safe installed/runtime probe for Business Partner mode + the Hermes-native
// sandbox. It NEVER starts Docker and never leaves a container behind: it only
// requests the Docker tier and asserts the honest fail-closed-to-guard result
// while Docker is stopped. Original partner settings are restored on exit.

const executablePath =
  process.env.HERMES_BUSINESS_EXE ||
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'hermes-business', "תכל'ס.exe")

if (!existsSync(executablePath)) {
  throw new Error(`Installed companion was not found: ${executablePath}`)
}

const userData = path.join(os.tmpdir(), `hermes-business-partner-ui-${Date.now()}`)
const app = await electron.launch({ executablePath, args: [`--user-data-dir=${userData}`], timeout: 120_000 })

let page
let original
try {
  page = await app.firstWindow({ timeout: 60_000 })
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(() => localStorage.setItem('hermes-business-onboarding-v1', 'complete'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 90_000 })

  original = await page.evaluate(() => window.hermesDesktop.getPartnerState())

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

  console.log(
    JSON.stringify({
      ok: true,
      partnerActivated: partnerState.personalityActive,
      dockerFailedClosed: plan.effective === 'guard' && plan.degraded === true,
      backend: dockerRequested.backend,
      dockerStatus: dockerRequested.docker.status,
      approvalSemantics: plan.approvalSemantics
    })
  )
} finally {
  if (page && original) {
    await page
      .evaluate(
        settings =>
          window.hermesDesktop.applyPartnerMode({
            mode: settings.mode,
            sandbox: settings.sandbox,
            network: settings.network,
            checkins: settings.checkins,
            checkinCadence: settings.checkinCadence,
            roots: settings.roots
          }),
        original
      )
      .catch(() => undefined)
  }
  await app.close()
}
