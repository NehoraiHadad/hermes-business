// Mini-chat probe: completes onboarding, switches to the always-on-top mini
// window, verifies its geometry, streams a marker reply and confirms the mini
// session is visible through the shared Hermes session.list.

import { composerLocator, findSessionByMarker, stopButtonLocator } from '../../installed-app.mjs'

/**
 * @returns `{ marker, stopDuringStreaming, windowState, windowDetails, sharedSession }`.
 */
export async function runMiniChat(ctx) {
  const { page, electronApp, marker } = ctx

  await page.evaluate(async () => {
    localStorage.setItem('hermes-business-onboarding-v1', 'complete')
    await window.hermesDesktop.setWindowMode('mini')
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.mini-shell').waitFor({ state: 'visible', timeout: 30_000 })
  await page.getByText('מוכן לעזור', { exact: true }).waitFor({ state: 'visible', timeout: 90_000 })

  const windowState = await page.evaluate(async () => window.hermesDesktop.getWindowState())
  const windowDetails = await electronApp.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows()[0]
    return {
      alwaysOnTop: target?.isAlwaysOnTop() || false,
      bounds: target?.getBounds() || null,
      visible: target?.isVisible() || false
    }
  })
  const directPinProbe = !windowDetails.alwaysOnTop
    ? await electronApp.evaluate(({ BrowserWindow }) => {
        const target = BrowserWindow.getAllWindows()[0]
        const levels = ['normal', 'floating', 'pop-up-menu', 'screen-saver']
        const attempts = []
        for (const level of levels) {
          target?.setAlwaysOnTop(false)
          target?.setAlwaysOnTop(true, level)
          attempts.push({ level, alwaysOnTop: target?.isAlwaysOnTop() || false })
          if (target?.isAlwaysOnTop()) break
        }
        return { alwaysOnTop: target?.isAlwaysOnTop() || false, bounds: target?.getBounds() || null, attempts }
      })
    : null
  if (windowState.mode !== 'mini' || !windowState.alwaysOnTop) {
    throw new Error(`Mini window state is incorrect: ${JSON.stringify(windowState)}`)
  }
  if (!windowDetails.alwaysOnTop || !windowDetails.visible || windowDetails.bounds?.width !== 390) {
    throw new Error(`Mini BrowserWindow geometry is incorrect: ${JSON.stringify({ windowDetails, directPinProbe })}`)
  }

  const composer = composerLocator(page)
  await composer.fill(`בדיקת התקנה: ענה בדיוק ${marker}`)
  await composer.press('Enter')
  const stopButton = stopButtonLocator(page)
  await stopButton.waitFor({ state: 'visible', timeout: 30_000 })
  const stopDuringStreaming = await stopButton.isVisible()
  await page.locator('.message--assistant').filter({ hasText: marker }).waitFor({
    state: 'visible',
    timeout: 180_000
  })
  await stopButton.waitFor({ state: 'hidden', timeout: 30_000 })

  const sharedSession = await findSessionByMarker(page, marker, { limit: 100 })
  if (!sharedSession) throw new Error('The mini-chat session was not visible through Hermes session.list')

  return { marker, stopDuringStreaming, windowState, windowDetails, sharedSession }
}
