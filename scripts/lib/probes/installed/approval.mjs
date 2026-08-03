// Approval probe (opt-in via HERMES_BUSINESS_E2E_APPROVAL): forces manual
// approval mode, asks the agent to run a destructive terminal command, and
// proves the denied approval never touches its target file. Records the prior
// approval mode on ctx so the orchestrator can restore it in its finally block —
// and DURABLY, in a restore journal, so a crash between the two cannot leave the
// operator's live profile on a mode they never chose.

import { existsSync } from 'node:fs'
import { writeRestoreJournal } from '../../live-restore-journal.mjs'
import { composerLocator, gatewayRpc } from '../../installed-app.mjs'

/** Restore-journal key for the live `approvals.mode` config value. */
export const APPROVAL_MODE_JOURNAL = 'approvals-mode'

/**
 * @returns the `approvalProbe` object, or null when the probe is disabled.
 */
export async function runApproval(ctx) {
  const { page, runApprovalProbe, approvalProbePath } = ctx
  if (!runApprovalProbe) return null

  const composer = composerLocator(page)

  const currentMode = await gatewayRpc(page, 'config.get', { key: 'approvals.mode' })
  ctx.originalApprovalMode = currentMode?.value || 'manual'
  // Journal BEFORE the mutation, never after.
  writeRestoreJournal(APPROVAL_MODE_JOURNAL, ctx.originalApprovalMode, {
    meta: { label: 'the live approvals.mode', scope: ctx.approvalScope ?? null }
  })
  await gatewayRpc(page, 'config.set', { key: 'approvals.mode', value: 'manual' })

  await composer.fill(
    [
      'בדיקת מנגנון אישור בלבד.',
      `השתמש בכלי terminal כדי לנסות להריץ: powershell.exe -NoProfile -Command "Remove-Item -LiteralPath '${approvalProbePath}'"`,
      'אל תשנה את הפקודה ואל תנסה דרך אחרת. המתן להחלטת המשתמש.'
    ].join(' ')
  )
  await composer.press('Enter')

  const approvalCard = page.locator('.approval-card')
  await approvalCard.waitFor({ state: 'visible', timeout: 180_000 })
  const cardText = await approvalCard.innerText()
  if (!/אשר פעם אחת/.test(cardText) || !/דחה/.test(cardText)) {
    throw new Error(`Approval card is missing clear actions: ${cardText}`)
  }
  await approvalCard.getByRole('button', { name: 'דחה' }).click()
  await approvalCard.waitFor({ state: 'hidden', timeout: 30_000 })
  if (existsSync(approvalProbePath)) {
    throw new Error('The denied approval probe unexpectedly created or retained its target file')
  }

  return { denied: true, cardText, targetAbsent: true }
}
