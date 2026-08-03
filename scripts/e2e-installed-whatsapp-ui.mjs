// Installed-app probe for the WhatsApp connection screen.
//
// This probe deliberately mutates LIVE user state: it flips the real WhatsApp
// reply policy to prove the dialog actually persists it. The original policy is
// therefore journalled to disk BEFORE the first mutation (see
// ./lib/live-restore-journal.mjs) so an app crash, a Ctrl-C or a killed node
// process cannot leave the profile silently changed — the next run recovers the
// journalled value first, and a failed restore is loud, never swallowed.

import { withLiveRestore } from './lib/live-restore-journal.mjs'
import { withProbeApp } from './lib/probe-app.mjs'
import { assertSafeInstalledE2E } from './lib/e2e-safety.mjs'

const safety = assertSafeInstalledE2E()
// A journal belongs to the profile it was captured from: an isolated QA home, or
// the operator's live profile under the disposable-host hatch.
const scope = safety.home || 'live-profile'

await withProbeApp({ prefix: 'hermes-business-whatsapp-ui' }, async ({ page }) => {
  const summary = await withLiveRestore(
    {
      key: 'whatsapp-policy',
      label: 'the live WhatsApp reply policy',
      scope,
      capture: () => page.evaluate(() => window.hermesDesktop.getWhatsappPolicy()),
      restore: policy => page.evaluate(value => window.hermesDesktop.setWhatsappPolicy(value), policy),
      // The bridge echoes back a normalized policy, so compare only the fields
      // this probe actually changes.
      equals: (a, b) =>
        a?.mode === b?.mode && JSON.stringify(a?.reply_chats || []) === JSON.stringify(b?.reply_chats || [])
    },
    async () => {
      await page.locator('.main-nav__item').filter({ hasText: 'חיבורים' }).click()
      await page.getByRole('heading', { name: 'חיבורים', level: 1 }).waitFor({ state: 'visible' })

      const officialCard = page.locator('.connection-card').filter({ hasText: 'WhatsApp Business' })
      await officialCard.getByRole('button').click()
      const officialDialog = page.getByRole('dialog', { name: 'חיבור WhatsApp Business' })
      await officialDialog.getByText('Meta Cloud', { exact: false }).first().waitFor({ state: 'visible' })
      await officialDialog.getByLabel('Phone Number ID').waitFor({ state: 'visible' })
      await officialDialog.getByLabel('Access Token').waitFor({ state: 'visible' })
      await officialDialog.getByLabel('App Secret').waitFor({ state: 'visible' })
      await officialDialog.getByRole('button', { name: /שמור ב־Hermes והפעל/ }).waitFor({ state: 'visible' })
      await officialDialog.getByRole('button', { name: 'סגור' }).click()

      const personalCard = page.locator('.connection-card').filter({ hasText: 'WhatsApp אישי' })
      await personalCard.getByRole('button').click()
      const dialog = page.getByRole('dialog', { name: 'חיבור WhatsApp אישי' })
      const readOnly = dialog.getByRole('radio', { name: /קריאה בלבד/ })
      const selected = dialog.getByRole('radio', { name: /מענה לשיחות פרטיות נבחרות בלבד/ })
      await readOnly.waitFor({ state: 'visible' })
      if (!(await readOnly.isChecked())) throw new Error('WhatsApp did not open fail-closed in read-only mode')

      await selected.check()
      await dialog.getByRole('textbox').fill('+972-50-000-0000\n15551234567')
      await dialog.getByRole('button', { name: /שמור מדיניות/ }).click()
      await dialog.getByRole('button', { name: /נשמר/ }).waitFor({ state: 'visible' })

      const selectedTruth = await page.evaluate(() => window.hermesDesktop.getWhatsappPolicy())
      if (
        selectedTruth.mode !== 'selected_chats' ||
        selectedTruth.reply_chats.join(',') !== '972500000000,15551234567'
      ) {
        throw new Error(`Selected-chat policy did not persist: ${JSON.stringify(selectedTruth)}`)
      }

      await readOnly.check()
      await dialog.getByRole('button', { name: /שמור מדיניות/ }).click()
      await dialog.getByRole('button', { name: /נשמר/ }).waitFor({ state: 'visible' })
      const readOnlyTruth = await page.evaluate(() => window.hermesDesktop.getWhatsappPolicy())
      if (readOnlyTruth.mode !== 'read_only') {
        throw new Error(`Read-only policy did not persist: ${JSON.stringify(readOnlyTruth)}`)
      }

      await dialog.getByRole('button', { name: /התחל חיבור עם קוד QR/ }).click()
      const qrGraphic = dialog.locator('.whatsapp-qr__code > svg[role="img"]')
      await Promise.race([
        qrGraphic.waitFor({ state: 'visible', timeout: 90_000 }),
        dialog.getByRole('button', { name: /סיים והפעל/ }).waitFor({ state: 'visible', timeout: 90_000 })
      ])
      const qrVisible = await qrGraphic.isVisible().catch(() => false)
      const cancel = dialog.getByRole('button', { name: 'בטל' })
      if (await cancel.isVisible().catch(() => false)) await cancel.click()

      return { selectedChatsPersisted: selectedTruth.reply_chats, qrVisible }
    }
  )

  console.log(
    JSON.stringify({
      ok: true,
      officialModeTruthful: true,
      defaultReadOnly: true,
      selectedChatsPersisted: summary.result.selectedChatsPersisted,
      readOnlyPersisted: true,
      qrVisible: summary.result.qrVisible,
      livePolicyRestored: true,
      recoveredCrashedRestore: summary.recovered
    })
  )
})
