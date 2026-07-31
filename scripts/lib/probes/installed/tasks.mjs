// Scheduled-tasks probe: creates a paused wrapper task, verifies it appears
// paused in the Hermes cron API, then removes it to leave no residue.

import { navigateScreen } from '../../installed-app.mjs'

/**
 * @returns the `taskTruth` cron job as returned by the Hermes cron API.
 */
export async function runTasks(ctx) {
  const { page, taskName } = ctx

  await navigateScreen(page, 'משימות מתוזמנות', { waitHeading: true, timeout: 30_000 })

  await page.getByRole('button', { name: 'משימה חדשה' }).click()
  const taskDialog = page.getByRole('dialog', { name: 'משימה מתוזמנת חדשה' })
  await taskDialog.getByLabel('שם המשימה').fill(taskName)
  await taskDialog.getByLabel('מה העוזר יעשה?').fill('כתוב בדיקת תקינות קצרה בלבד. אל תשלח הודעות.')
  await taskDialog.getByLabel('שעה').fill('23:59')
  await taskDialog.getByRole('button', { name: 'צור משימה' }).click()

  const taskRow = page.locator('.task-row').filter({ hasText: taskName })
  await taskRow.waitFor({ state: 'visible', timeout: 30_000 })
  await taskRow.getByRole('button', { name: 'השהה' }).click()
  await taskRow.getByRole('button', { name: 'הפעל' }).waitFor({ state: 'visible', timeout: 30_000 })

  const taskTruth = await page.evaluate(async expectedName => {
    const result = await window.hermesDesktop.api('/api/cron/jobs?profile=default')
    const jobs = Array.isArray(result) ? result : result.jobs || []
    return jobs.find(job => job.name === expectedName) || null
  }, taskName)
  if (!taskTruth || taskTruth.enabled !== false) {
    throw new Error(`Wrapper task was not visible and paused in Hermes: ${JSON.stringify(taskTruth)}`)
  }
  await page.evaluate(async taskId => {
    await window.hermesDesktop.api(`/api/cron/jobs/${encodeURIComponent(taskId)}?profile=default`, {
      method: 'DELETE'
    })
  }, taskTruth.id)

  return taskTruth
}
