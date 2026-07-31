// Setup-wizard probe: walks the guided onboarding — AI provider (Codex OAuth),
// Google Workspace and Telegram connection dialogs — verifying each surface
// matches the Hermes source of truth.

/**
 * @returns the `setupUiProbe` recorded in the final report.
 */
export async function runSetupWizard(ctx) {
  const { page } = ctx

  await page.getByText('Hermes זוהה ופועל במחשב', { exact: true }).waitFor({ state: 'visible', timeout: 90_000 })
  await page.locator('.onboarding__footer .primary-button').click()
  await page.getByRole('button', { name: 'חבר ספק AI' }).click()

  const providerDialog = page.getByRole('dialog', { name: 'חיבור לספק AI' })
  await providerDialog.waitFor({ state: 'visible' })
  await providerDialog.getByLabel('ספק').waitFor({ state: 'visible' })

  const oauthTruth = await page.evaluate(async () =>
    window.hermesDesktop.api('/api/providers/oauth?profile=default')
  )
  const codexConnected = Boolean(
    oauthTruth.providers?.find(provider => provider.id === 'openai-codex')?.status?.logged_in
  )
  const expectedOAuthText = codexConnected ? 'חשבון ChatGPT כבר מחובר ל־Hermes.' : 'חבר באמצעות ChatGPT'
  await providerDialog.getByText(expectedOAuthText, { exact: false }).waitFor({ state: 'visible', timeout: 30_000 })
  if (codexConnected) {
    await providerDialog.getByRole('button', { name: 'השתמש בחיבור הזה' }).click()
    await providerDialog.waitFor({ state: 'hidden', timeout: 30_000 })
  } else {
    await providerDialog.getByRole('button', { name: 'סגור' }).click()
  }

  for (let step = 0; step < 3; step += 1) {
    await page.locator('.onboarding__footer .primary-button').click()
  }

  await page.getByRole('button', { name: /Google Workspace/ }).click()
  const googleOnboardingDialog = page.getByRole('dialog', { name: 'חיבור Google Workspace' })
  await googleOnboardingDialog.waitFor({ state: 'visible' })
  await googleOnboardingDialog.getByRole('button', { name: 'סגור' }).click()

  await page.getByRole('button', { name: /Telegram/ }).click()
  const telegramOnboardingDialog = page.getByRole('dialog', { name: 'חיבור Telegram' })
  await telegramOnboardingDialog.waitFor({ state: 'visible' })
  await telegramOnboardingDialog.getByRole('button', { name: 'סגור' }).click()

  return {
    provider: 'openai-codex',
    codexConnected,
    oauthActivated: codexConnected,
    googleActionVisible: true,
    telegramActionVisible: true
  }
}
