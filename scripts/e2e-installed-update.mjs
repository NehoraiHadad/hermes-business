import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'

const executable = path.join(
  process.env.LOCALAPPDATA || '',
  'Programs',
  'hermes-business',
  'העוזר לעסק.exe'
)
if (!existsSync(executable)) throw new Error(`Installed companion not found: ${executable}`)

const app = await electron.launch({
  executablePath: executable,
  args: [`--user-data-dir=${path.join(os.tmpdir(), `hermes-business-update-${Date.now()}`)}`],
  timeout: 120_000
})

async function snapshot(page) {
  return page.evaluate(async () => {
    const [skillsResult, cronResult, runtime] = await Promise.all([
      window.hermesDesktop.api('/api/skills?profile=default'),
      window.hermesDesktop.api('/api/cron/jobs?profile=default'),
      window.hermesDesktop.getRuntime()
    ])
    const sessions = await new Promise((resolve, reject) => {
      const socket = new WebSocket(runtime.wsUrl)
      const timer = window.setTimeout(() => reject(new Error('session.list timed out')), 20_000)
      socket.addEventListener('open', () => socket.send(JSON.stringify({
        jsonrpc: '2.0', id: 'update-state', method: 'session.list', params: { limit: 100 }
      })))
      socket.addEventListener('message', event => {
        const frame = JSON.parse(String(event.data))
        if (frame.id !== 'update-state') return
        window.clearTimeout(timer)
        socket.close()
        if (frame.error) reject(new Error(frame.error.message))
        else resolve(frame.result?.sessions || [])
      })
      socket.addEventListener('error', () => reject(new Error('session.list socket failed')))
    })
    const skills = Array.isArray(skillsResult) ? skillsResult : skillsResult.skills || []
    const jobs = Array.isArray(cronResult) ? cronResult : cronResult.jobs || []
    return {
      sessionCount: sessions.length,
      skillCount: skills.length,
      cronCount: jobs.length,
      durableSkillPresent: skills.some(skill => skill.name === 'poc-weekly-lead-summary')
    }
  })
}

try {
  const page = await app.firstWindow({ timeout: 60_000 })
  const consoleErrors = []
  const pageErrors = []
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', error => pageErrors.push(String(error)))
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(() => localStorage.setItem('hermes-business-onboarding-v1', 'complete'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 90_000 })

  const before = await snapshot(page)
  await page.locator('.main-nav__item').filter({ hasText: 'תמיכה ותקינות' }).click()
  const checkButton = page.getByRole('button', { name: 'בדוק עדכון' })
  await checkButton.click()
  await page.getByRole('button', { name: 'עדכן עכשיו' }).waitFor({
    state: 'visible', timeout: 90_000
  })

  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'עדכן עכשיו' }).click()
  await page.getByText('Hermes עודכן ובדיקת התקינות עברה בהצלחה', { exact: true }).waitFor({
    state: 'visible', timeout: 600_000
  })

  const health = await page.evaluate(() => window.hermesDesktop.api('/api/health'))
  const update = await page.evaluate(() =>
    window.hermesDesktop.api('/api/hermes/update/check?force=true')
  )
  const after = await snapshot(page)
  if (!health.ok) throw new Error(`Post-update health failed: ${JSON.stringify(health)}`)
  if (!after.durableSkillPresent || after.sessionCount < before.sessionCount) {
    throw new Error(`Hermes state was not preserved: ${JSON.stringify({ before, after })}`)
  }
  if (consoleErrors.length || pageErrors.length) {
    throw new Error(`Renderer errors after update: ${JSON.stringify({ consoleErrors, pageErrors })}`)
  }
  console.log(JSON.stringify({ ok: true, before, after, health, update }, null, 2))
} finally {
  await app.close()
}
