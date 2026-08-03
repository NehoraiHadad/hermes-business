// Onboarding-clarify probe (opt-in via HERMES_BUSINESS_E2E_ONBOARDING): drives
// the /business-bootstrap skill through one structured clarify question and
// answers it via the official clarify RPC path.

import { pollUntil } from '../../e2e-harness.mjs'
import { composerLocator, stopButtonLocator } from '../../installed-app.mjs'

/**
 * @returns the `onboardingProbe` object, or null when the probe is disabled.
 */
export async function runOnboardingClarify(ctx) {
  const { page, runOnboardingProbe } = ctx
  if (!runOnboardingProbe) return null

  const composer = composerLocator(page)
  const stopButton = stopButtonLocator(page)

  await page.getByRole('button', { name: 'שיחה חדשה' }).click()
  await page.locator('.message--assistant').filter({ hasText: 'היי, אני כאן' }).waitFor({
    state: 'visible',
    timeout: 30_000
  })
  await composer.fill(
    [
      '/business-bootstrap',
      'התחל הקמה מודרכת אמיתית.',
      'המעטפת כבר בדקה דרך Hermes: provider_ready=true, skills=[business-bootstrap,poc-weekly-lead-summary], scheduled_tasks=1, connections=[].',
      'אל תחזור על הבדיקות. שאל עכשיו רק את השאלה החסרה הראשונה באמצעות כלי clarify.',
      'אל תבקש secrets ואל תבצע שינוי חיצוני.'
    ].join(' ')
  )
  await composer.press('Enter')

  const clarifyCard = page.locator('.clarify-card')
  await clarifyCard.waitFor({ state: 'visible', timeout: 180_000 })
  const question = (await clarifyCard.locator('p').first().innerText()).trim()
  if (!question || question.length > 500) {
    throw new Error(`Onboarding did not produce one concise structured question: ${question}`)
  }
  await clarifyCard.getByLabel(/התשובה שלך|תשובה אחרת/).fill('בדיקת POC בלבד — עצור אחרי אימות התשובה.')
  await clarifyCard.getByRole('button', { name: 'שלח תשובה' }).click()
  // Wait for the actual condition (the answer started a streaming turn) instead
  // of sleeping a guessed second. If the turn already finished, the stop button
  // never appears and there is nothing to stop — that is a normal outcome here,
  // so the poll timing out is not an error.
  const streaming = await pollUntil(() => stopButton.isVisible().catch(() => false), {
    timeoutMs: 5_000,
    intervalMs: 100,
    message: 'the streaming stop button after the clarify answer'
  }).catch(() => false)
  if (streaming) await stopButton.click().catch(() => undefined)

  return {
    skill: 'business-bootstrap',
    structuredQuestionVisible: true,
    question,
    answerSubmittedThroughOfficialClarifyRpc: true
  }
}
