// Skills-screen probe: ensures the durable POC skill exists (creating it via the
// guided wrapper dialog if needed) and confirms it is present in the official
// Hermes Skills API.

import { navigateScreen } from '../../installed-app.mjs'

/**
 * @returns the `skillTruth` object from the Hermes Skills API.
 */
export async function runSkills(ctx) {
  const { page, durableSkillName } = ctx

  await navigateScreen(page, 'מה העוזר יודע')

  let skillCard = page.locator('.skill-card').filter({ has: page.getByRole('heading', { name: durableSkillName }) })
  if (!(await skillCard.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'למד תהליך חדש' }).click()
    const skillDialog = page.getByRole('dialog', { name: 'למד את העוזר תהליך חדש' })
    await skillDialog.getByLabel('שם קצר לתהליך').fill(durableSkillName)
    await skillDialog
      .getByLabel('איך התהליך עובד?')
      .fill('אסוף לידים חדשים, חלק לפי דחיפות, וסכם למי כדאי לחזור קודם. אין לשלוח דבר ללא אישור.')
    await skillDialog.getByRole('button', { name: 'שמור Skill' }).click()
    // Deliberate settle: let the save round-trip surface any validation error.
    await page.waitForTimeout(2_000)
    const skillError = await skillDialog.locator('.form-error').textContent().catch(() => '')
    if (skillError) throw new Error(`Hermes rejected wrapper Skill creation: ${skillError}`)
    skillCard = page.locator('.skill-card').filter({ has: page.getByRole('heading', { name: durableSkillName }) })
    await skillCard.waitFor({ state: 'visible', timeout: 30_000 })
  }

  const skillTruth = await page.evaluate(async expectedName => {
    const skills = await window.hermesDesktop.api('/api/skills?profile=default')
    return skills.find(skill => skill.name === expectedName) || null
  }, durableSkillName)
  if (!skillTruth) throw new Error('Skill created in the wrapper is absent from the official Hermes Skills API')

  return skillTruth
}
