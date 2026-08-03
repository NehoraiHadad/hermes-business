// Installed-app probe for the chat attachment flow. It stubs the Electron file
// dialog (window.hermesDesktop.chooseFile) with a temp fixture and drives the
// real renderer in demo mode so the file.attach -> prompt.submit orchestration
// and the pending/sent/remove UI are exercised end-to-end without a live turn.
//
// Unlike the other UI probes this one enters the shell by NAVIGATING to `?demo=1`
// rather than reloading — the demo transport is the whole point — which is the
// `boot: 'demo'` option of the shared harness.
import { writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { withProbeApp } from './lib/probe-app.mjs'
import { assertSafeInstalledE2E } from './lib/e2e-safety.mjs'

assertSafeInstalledE2E()

const fixture = path.join(os.tmpdir(), `hermes-attach-${process.pid}-${Date.now()}.txt`)
writeFileSync(fixture, 'quarterly numbers: 42', 'utf8')
const fixtureName = path.basename(fixture)

try {
  await withProbeApp({ prefix: 'hermes-business-attach-ui', boot: 'demo' }, async ({ app, page }) => {
    const composer = page.getByRole('textbox', { name: 'הודעה לעוזר' })
    await composer.waitFor({ state: 'visible', timeout: 30_000 })

    // Stub the native file dialog in the MAIN process. The renderer bridge is a
    // frozen contextBridge API (contextIsolation: true), so it cannot be patched
    // from the page world; we mock dialog.showOpenDialog, which the
    // `hermes:choose-file` IPC handler resolves the chosen path through.
    await app.evaluate(async ({ dialog }, fixturePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixturePath] })
    }, fixture)

    const attachButton = page.getByRole('button', { name: 'צירוף קובץ' })

    // 1) Pick -> a pending chip appears; 2) remove -> it disappears.
    await attachButton.click()
    const chip = page.locator('.composer-chip').filter({ hasText: fixtureName })
    await chip.waitFor({ state: 'visible', timeout: 15_000 })
    await chip.getByRole('button', { name: `הסר את ${fixtureName}` }).click()
    await chip.waitFor({ state: 'hidden', timeout: 15_000 })

    // 3) Attachment-only send: send stays enabled with no text, and the sent
    // user bubble carries the attachment chip; the demo agent then replies.
    await attachButton.click()
    await chip.waitFor({ state: 'visible', timeout: 15_000 })
    const sendButton = page.getByRole('button', { name: 'שלח', exact: true })
    if (await sendButton.isDisabled()) throw new Error('Send was disabled for an attachment-only turn')
    await sendButton.click()

    const sentAttachment = page.locator('.message--user .message-attachment').filter({ hasText: fixtureName })
    await sentAttachment.waitFor({ state: 'visible', timeout: 20_000 })
    await page.locator('.message--assistant').last().waitFor({ state: 'visible', timeout: 30_000 })

    console.log(
      JSON.stringify({ ok: true, pickedAndRemoved: true, attachmentOnlyTurn: true, fixture: fixtureName })
    )
  })
} finally {
  rmSync(fixture, { force: true })
}
