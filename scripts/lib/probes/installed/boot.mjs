// Boot probe: waits for the installed renderer to finish its Hermes-detection
// splash, then asserts the isolated preload bridge and product UI are present.

/**
 * @returns the `initial` renderer snapshot recorded in the final report.
 */
export async function verifyBoot(ctx) {
  const { page, consoleMessages, pageErrors, screenshotPath } = ctx

  await page.waitForLoadState('domcontentloaded')
  // Deliberate settle: let the first paint land before probing the splash.
  await page.waitForTimeout(2_000)
  await page.getByText('בודק אם Hermes מותקן', { exact: false }).waitFor({
    state: 'hidden',
    timeout: 90_000
  })

  const initial = await page.evaluate(() => ({
    bodyText: document.body?.innerText || '',
    bodyHtmlLength: document.body?.innerHTML.length || 0,
    hasBridge: Boolean(window.hermesDesktop),
    title: document.title,
    url: location.href
  }))
  await page.screenshot({ path: screenshotPath })

  if (!initial.hasBridge) throw new Error('The isolated Electron preload bridge is missing')
  if (initial.bodyHtmlLength < 100 || !initial.bodyText.trim()) {
    throw new Error(
      `Installed renderer is blank. console=${JSON.stringify(consoleMessages)} pageErrors=${JSON.stringify(pageErrors)}`
    )
  }
  if (!/העוזר|Hermes/.test(initial.bodyText)) {
    throw new Error(`Installed renderer did not show the product UI: ${initial.bodyText.slice(0, 500)}`)
  }
  return initial
}
