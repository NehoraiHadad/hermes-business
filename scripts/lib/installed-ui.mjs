// Renderer UI locators + navigation for the installed-companion E2E suites.

/**
 * Click a left-nav item and, optionally, wait for its screen heading. Passing a
 * `timeout` scopes the heading wait; omitting it uses Playwright's default.
 */
export async function navigateScreen(page, label, { waitHeading = false, headingText, timeout } = {}) {
  await page.locator('.main-nav__item').filter({ hasText: label }).click()
  if (waitHeading) {
    const heading = page.locator('.content-screen h2').filter({ hasText: headingText || label })
    await heading.waitFor(timeout ? { state: 'visible', timeout } : { state: 'visible' })
  }
}

/** The mini-chat composer textbox. */
export function composerLocator(page) {
  return page.getByRole('textbox', { name: 'הודעה לעוזר' })
}

/** The "stop the streamed answer" button. */
export function stopButtonLocator(page) {
  return page.getByRole('button', { name: 'עצור תשובה' })
}
