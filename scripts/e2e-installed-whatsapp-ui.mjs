import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'

const executablePath =
  process.env.HERMES_BUSINESS_EXE ||
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'hermes-business', "תכל'ס.exe")

if (!existsSync(executablePath)) {
  throw new Error(`Installed companion was not found: ${executablePath}`)
}

const userData = path.join(os.tmpdir(), `hermes-business-whatsapp-ui-${Date.now()}`)
const app = await electron.launch({
  executablePath,
  args: [`--user-data-dir=${userData}`],
  timeout: 120_000
})

let page
let originalPolicy
try {
  page = await app.firstWindow({ timeout: 60_000 })
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(() => localStorage.setItem('hermes-business-onboarding-v1', 'complete'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 90_000 })

  originalPolicy = await page.evaluate(() => window.hermesDesktop.getWhatsappPolicy())
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

  console.log(
    JSON.stringify({
      ok: true,
      officialModeTruthful: true,
      defaultReadOnly: true,
      selectedChatsPersisted: selectedTruth.reply_chats,
      readOnlyPersisted: true,
      qrVisible
    })
  )
} finally {
  if (page && originalPolicy) {
    await page.evaluate(policy => window.hermesDesktop.setWhatsappPolicy(policy), originalPolicy).catch(() => undefined)
  }
  await app.close()
}
