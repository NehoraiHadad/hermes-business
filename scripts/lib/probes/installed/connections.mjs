// Connections-screen probe: reconciles the Telegram card and Google status
// against the Hermes messaging/Google source of truth and verifies an invalid
// Google client-secret path is rejected without changing auth state.

import { navigateScreen } from '../../installed-app.mjs'

/**
 * @returns `{ connectionTruth, googleFailureProbe }`.
 */
export async function runConnections(ctx) {
  const { page } = ctx

  await navigateScreen(page, 'חיבורים', { waitHeading: true })

  const connectionTruth = await page.evaluate(async () => {
    const [messaging, google] = await Promise.all([
      window.hermesDesktop.api('/api/messaging/platforms?profile=default'),
      window.hermesDesktop.getGoogleStatus()
    ])
    const selected = (messaging.platforms || [])
      .filter(item => ['telegram', 'whatsapp', 'whatsapp_cloud'].includes(item.id))
      .map(item => ({
        id: item.id,
        enabled: item.enabled,
        configured: item.configured,
        gateway_running: item.gateway_running,
        state: item.state,
        error_code: item.error_code || null
      }))
    return { platforms: selected, google }
  })

  const googleFailureProbe = await page.evaluate(async () => {
    const before = await window.hermesDesktop.getGoogleStatus()
    let rejected = false
    try {
      await window.hermesDesktop.startGoogleSetup(
        'C:\\definitely-missing-hermes-business-e2e\\client_secret.json',
        'all'
      )
    } catch {
      rejected = true
    }
    const after = await window.hermesDesktop.getGoogleStatus()
    return { rejected, before, after }
  })
  if (
    !googleFailureProbe.rejected ||
    googleFailureProbe.before.authenticated !== googleFailureProbe.after.authenticated
  ) {
    throw new Error(`Google invalid-input flow was not safely rejected: ${JSON.stringify(googleFailureProbe)}`)
  }

  const telegramCard = page.locator('.connection-card').filter({ hasText: 'Telegram' })
  await telegramCard.waitFor({ state: 'visible' })
  const telegramPlatform = connectionTruth.platforms.find(item => item.id === 'telegram')
  const expectedTelegramConnected =
    telegramPlatform?.enabled && telegramPlatform?.configured && telegramPlatform?.state === 'connected'
  const telegramShownConnected = await telegramCard
    .getByRole('button', { name: 'מחובר' })
    .isVisible()
    .catch(() => false)
  if (Boolean(expectedTelegramConnected) !== telegramShownConnected) {
    throw new Error(
      `Telegram UI does not match Hermes source of truth: ${JSON.stringify({
        telegramPlatform,
        telegramShownConnected
      })}`
    )
  }
  await telegramCard.getByRole('button').click()
  const telegramDialog = page.getByRole('dialog', { name: 'חיבור Telegram' })
  await telegramDialog.waitFor({ state: 'visible' })
  if (
    !(await telegramDialog.getByLabel('Bot token').isVisible()) ||
    !(await telegramDialog.getByLabel('Telegram user ID').isVisible())
  ) {
    throw new Error('Telegram guided connection form is incomplete')
  }
  await telegramDialog.getByRole('button', { name: 'ביטול' }).click()

  return { connectionTruth, googleFailureProbe }
}
