import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { _electron as electron } from 'playwright-core'

const projectRoot = path.resolve(import.meta.dirname, '..')
const defaultExecutable = path.join(
  process.env.LOCALAPPDATA || '',
  'Programs',
  'hermes-business',
  'העוזר לעסק.exe'
)
const executablePath = process.env.HERMES_BUSINESS_EXE || defaultExecutable
const appDirectory = process.env.HERMES_BUSINESS_APP_DIR || ''
if (!existsSync(executablePath)) {
  throw new Error(`Installed companion was not found: ${executablePath}`)
}

const artifactDirectory = path.join(projectRoot, 'release')
mkdirSync(artifactDirectory, { recursive: true })
const screenshotPath = path.join(artifactDirectory, 'e2e-installed-ui.png')
const miniScreenshotPath = path.join(artifactDirectory, 'e2e-installed-mini-chat.png')
const userDataDirectory = path.join(os.tmpdir(), `hermes-business-e2e-${Date.now()}`)
const consoleMessages = []
const pageErrors = []
const marker = `INSTALLED_MINI_E2E_OK_${Date.now()}`
const runApprovalProbe = process.env.HERMES_BUSINESS_E2E_APPROVAL === '1'
const runOnboardingProbe = process.env.HERMES_BUSINESS_E2E_ONBOARDING !== '0'
const approvalProbePath = path.join(os.tmpdir(), `hermes-business-approval-probe-${Date.now()}.txt`)
const diagnosticsPath = path.join(os.tmpdir(), `hermes-business-diagnostics-e2e-${Date.now()}.zip`)
const taskName = `בדיקת POC ${Date.now()}`
const durableSkillName = 'poc-weekly-lead-summary'
let page = null
let originalApprovalMode = null

async function gatewayRpc(targetPage, method, params) {
  return targetPage.evaluate(
    async request => {
      const runtime = await window.hermesDesktop.getRuntime()
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(runtime.wsUrl)
        const timer = window.setTimeout(() => {
          socket.close()
          reject(new Error(`Gateway RPC timed out: ${request.method}`))
        }, 20_000)
        socket.addEventListener('open', () => {
          socket.send(JSON.stringify({ jsonrpc: '2.0', id: 'e2e-config', ...request }))
        })
        socket.addEventListener('message', event => {
          const frame = JSON.parse(String(event.data))
          if (frame.id !== 'e2e-config') return
          window.clearTimeout(timer)
          socket.close()
          if (frame.error) reject(new Error(frame.error.message || 'Gateway RPC failed'))
          else resolve(frame.result)
        })
        socket.addEventListener('error', () => {
          window.clearTimeout(timer)
          reject(new Error('Gateway RPC socket failed'))
        })
      })
    },
    { method, params }
  )
}

const electronApp = await electron.launch({
  executablePath,
  args: [...(appDirectory ? [appDirectory] : []), `--user-data-dir=${userDataDirectory}`],
  timeout: 120_000
})

try {
  page = await electronApp.firstWindow({ timeout: 60_000 })
  page.on('console', message => consoleMessages.push(`[${message.type()}] ${message.text()}`))
  page.on('pageerror', error => pageErrors.push(String(error?.stack || error)))
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(2_000)
  await page.waitForFunction(() => !document.body.innerText.includes('בודק אם Hermes מותקן'), null, {
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

  await page.getByText('Hermes זוהה ופועל במחשב', { exact: true }).waitFor({ state: 'visible', timeout: 90_000 })
  await page.locator('.onboarding__footer .primary-button').click()
  await page.getByRole('button', { name: 'חבר ספק AI' }).click()
  const providerDialog = page.getByRole('dialog', { name: 'חיבור לספק AI' })
  await providerDialog.waitFor({ state: 'visible' })
  await providerDialog.getByLabel('ספק').waitFor({ state: 'visible' })
  const oauthTruth = await page.evaluate(async () =>
    window.hermesDesktop.api('/api/providers/oauth?profile=default')
  )
  const codexConnected = Boolean(
    oauthTruth.providers?.find(provider => provider.id === 'openai-codex')?.status?.logged_in
  )
  const expectedOAuthText = codexConnected ? 'חשבון ChatGPT כבר מחובר ל־Hermes.' : 'חבר באמצעות ChatGPT'
  await providerDialog.getByText(expectedOAuthText, { exact: false }).waitFor({ state: 'visible', timeout: 30_000 })
  if (codexConnected) {
    await providerDialog.getByRole('button', { name: 'השתמש בחיבור הזה' }).click()
    await providerDialog.waitFor({ state: 'hidden', timeout: 30_000 })
  } else {
    await providerDialog.getByRole('button', { name: 'סגור' }).click()
  }

  for (let step = 0; step < 3; step += 1) {
    await page.locator('.onboarding__footer .primary-button').click()
  }
  await page.getByRole('button', { name: /Google Workspace/ }).click()
  const googleOnboardingDialog = page.getByRole('dialog', { name: 'חיבור Google Workspace' })
  await googleOnboardingDialog.waitFor({ state: 'visible' })
  await googleOnboardingDialog.getByRole('button', { name: 'סגור' }).click()
  await page.getByRole('button', { name: /Telegram/ }).click()
  const telegramOnboardingDialog = page.getByRole('dialog', { name: 'חיבור Telegram' })
  await telegramOnboardingDialog.waitFor({ state: 'visible' })
  await telegramOnboardingDialog.getByRole('button', { name: 'סגור' }).click()
  const setupUiProbe = {
    provider: 'openai-codex',
    codexConnected,
    oauthActivated: codexConnected,
    googleActionVisible: true,
    telegramActionVisible: true
  }

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
        return {
          alwaysOnTop: target?.isAlwaysOnTop() || false,
          bounds: target?.getBounds() || null,
          attempts
        }
      })
    : null
  if (windowState.mode !== 'mini' || !windowState.alwaysOnTop) {
    throw new Error(`Mini window state is incorrect: ${JSON.stringify(windowState)}`)
  }
  if (!windowDetails.alwaysOnTop || !windowDetails.visible || windowDetails.bounds?.width !== 390) {
    throw new Error(
      `Mini BrowserWindow geometry is incorrect: ${JSON.stringify({ windowDetails, directPinProbe })}`
    )
  }

  const composer = page.getByRole('textbox', { name: 'הודעה לעוזר' })
  await composer.fill(`בדיקת התקנה: ענה בדיוק ${marker}`)
  await composer.press('Enter')
  const stopButton = page.getByRole('button', { name: 'עצור תשובה' })
  await stopButton.waitFor({ state: 'visible', timeout: 30_000 })
  const stopDuringStreaming = await stopButton.isVisible()
  await page.locator('.message--assistant').filter({ hasText: marker }).waitFor({
    state: 'visible',
    timeout: 180_000
  })
  await stopButton.waitFor({ state: 'hidden', timeout: 30_000 })

  const sharedSession = await page.evaluate(async expectedMarker => {
    const runtime = await window.hermesDesktop.getRuntime()
    return await new Promise((resolve, reject) => {
      const socket = new WebSocket(runtime.wsUrl)
      const timer = window.setTimeout(() => {
        socket.close()
        reject(new Error('session.list verification timed out'))
      }, 20_000)
      socket.addEventListener('open', () => {
        socket.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 'installed-ui-session-list',
            method: 'session.list',
            params: { limit: 100 }
          })
        )
      })
      socket.addEventListener('message', event => {
        const frame = JSON.parse(String(event.data))
        if (frame.id !== 'installed-ui-session-list') return
        window.clearTimeout(timer)
        socket.close()
        const sessions = frame.result?.sessions || []
        resolve(
          sessions.find(session =>
            `${session.title || ''} ${session.preview || ''}`.includes(expectedMarker)
          ) || null
        )
      })
      socket.addEventListener('error', () => {
        window.clearTimeout(timer)
        reject(new Error('Could not verify the shared Hermes session'))
      })
    })
  }, marker)
  if (!sharedSession) throw new Error('The mini-chat session was not visible through Hermes session.list')

  let onboardingProbe = null
  if (runOnboardingProbe) {
    await page.getByRole('button', { name: 'שיחה חדשה' }).click()
    await page.locator('.message--assistant').filter({ hasText: 'היי, אני כאן' }).waitFor({
      state: 'visible',
      timeout: 30_000
    })
    await composer.fill(
      [
        '/business-bootstrap',
        'התחל הקמה מודרכת אמיתית.',
        'המעטפת כבר בדקה דרך Hermes: provider_ready=true, skills=[business-bootstrap,poc-weekly-lead-summary], scheduled_tasks=1, connections=[].',
        'אל תחזור על הבדיקות. שאל עכשיו רק את השאלה החסרה הראשונה באמצעות כלי clarify.',
        'אל תבקש secrets ואל תבצע שינוי חיצוני.'
      ].join(' ')
    )
    await composer.press('Enter')
    const clarifyCard = page.locator('.clarify-card')
    await clarifyCard.waitFor({ state: 'visible', timeout: 180_000 })
    const question = (await clarifyCard.locator('p').first().innerText()).trim()
    if (!question || question.length > 500) {
      throw new Error(`Onboarding did not produce one concise structured question: ${question}`)
    }
    await clarifyCard.getByLabel(/התשובה שלך|תשובה אחרת/).fill('בדיקת POC בלבד — עצור אחרי אימות התשובה.')
    await clarifyCard.getByRole('button', { name: 'שלח תשובה' }).click()
    await page.waitForTimeout(1_000)
    if (await stopButton.isVisible().catch(() => false)) await stopButton.click()
    onboardingProbe = {
      skill: 'business-bootstrap',
      structuredQuestionVisible: true,
      question,
      answerSubmittedThroughOfficialClarifyRpc: true
    }
  }

  let approvalProbe = null
  if (runApprovalProbe) {
    const currentMode = await gatewayRpc(page, 'config.get', { key: 'approvals.mode' })
    originalApprovalMode = currentMode?.value || 'manual'
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
    approvalProbe = { denied: true, cardText, targetAbsent: true }
  }

  await page.screenshot({ path: miniScreenshotPath })

  await page.getByRole('button', { name: 'פתח חלון מלא' }).click()
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30_000 })

  await page.locator('.main-nav__item').filter({ hasText: 'חיבורים' }).click()
  await page.locator('.content-screen h2').filter({ hasText: 'חיבורים' }).waitFor({ state: 'visible' })
  const connectionTruth = await page.evaluate(async () => {
    const [messaging, google] = await Promise.all([
      window.hermesDesktop.api('/api/messaging/platforms?profile=default'),
      window.hermesDesktop.getGoogleStatus()
    ])
    const selected = (messaging.platforms || [])
      .filter(item => ['telegram', 'whatsapp', 'whatsapp_cloud'].includes(item.id))
      .map(item => ({
        id: item.id,
        enabled: item.enabled,
        configured: item.configured,
        gateway_running: item.gateway_running,
        state: item.state,
        error_code: item.error_code || null
      }))
    return { platforms: selected, google }
  })
  const googleFailureProbe = await page.evaluate(async () => {
    const before = await window.hermesDesktop.getGoogleStatus()
    let rejected = false
    try {
      await window.hermesDesktop.startGoogleSetup(
        'C:\\definitely-missing-hermes-business-e2e\\client_secret.json',
        'all'
      )
    } catch {
      rejected = true
    }
    const after = await window.hermesDesktop.getGoogleStatus()
    return { rejected, before, after }
  })
  if (
    !googleFailureProbe.rejected ||
    googleFailureProbe.before.authenticated !== googleFailureProbe.after.authenticated
  ) {
    throw new Error(`Google invalid-input flow was not safely rejected: ${JSON.stringify(googleFailureProbe)}`)
  }
  const telegramCard = page.locator('.connection-card').filter({ hasText: 'Telegram' })
  await telegramCard.waitFor({ state: 'visible' })
  const telegramPlatform = connectionTruth.platforms.find(item => item.id === 'telegram')
  const expectedTelegramConnected =
    telegramPlatform?.enabled && telegramPlatform?.configured && telegramPlatform?.state === 'connected'
  const telegramShownConnected = await telegramCard.getByRole('button', { name: 'מחובר' }).isVisible().catch(() => false)
  if (Boolean(expectedTelegramConnected) !== telegramShownConnected) {
    throw new Error(
      `Telegram UI does not match Hermes source of truth: ${JSON.stringify({
        telegramPlatform,
        telegramShownConnected
      })}`
    )
  }
  await telegramCard.getByRole('button').click()
  const telegramDialog = page.getByRole('dialog', { name: 'חיבור Telegram' })
  await telegramDialog.waitFor({ state: 'visible' })
  if (
    !(await telegramDialog.getByLabel('Bot token').isVisible()) ||
    !(await telegramDialog.getByLabel('Telegram user ID').isVisible())
  ) {
    throw new Error('Telegram guided connection form is incomplete')
  }
  await telegramDialog.getByRole('button', { name: 'ביטול' }).click()

  await page.locator('.main-nav__item').filter({ hasText: 'מה העוזר יודע' }).click()
  let skillCard = page.locator('.skill-card').filter({ has: page.getByRole('heading', { name: durableSkillName }) })
  if (!(await skillCard.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'למד תהליך חדש' }).click()
    const skillDialog = page.getByRole('dialog', { name: 'למד את העוזר תהליך חדש' })
    await skillDialog.getByLabel('שם קצר לתהליך').fill(durableSkillName)
    await skillDialog
      .getByLabel('איך התהליך עובד?')
      .fill('אסוף לידים חדשים, חלק לפי דחיפות, וסכם למי כדאי לחזור קודם. אין לשלוח דבר ללא אישור.')
    await skillDialog.getByRole('button', { name: 'שמור Skill' }).click()
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

  await page.locator('.main-nav__item').filter({ hasText: 'משימות מתוזמנות' }).click()
  await page.locator('.content-screen h2').filter({ hasText: 'משימות מתוזמנות' }).waitFor({
    state: 'visible',
    timeout: 30_000
  })
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

  await page.locator('.main-nav__item').filter({ hasText: 'תמיכה ותקינות' }).click()
  await page.getByRole('button', { name: 'בדוק עדכון' }).click()
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('button')).some(button => button.textContent?.includes('בדוק עדכון') && button.disabled),
    null,
    { timeout: 15_000 }
  )
  await page.waitForFunction(() => !document.querySelector('button.outline-button .spin'), null, {
    timeout: 90_000
  })
  const updateTruth = await page.evaluate(async () =>
    window.hermesDesktop.api('/api/hermes/update/check?force=false')
  )
  if (!updateTruth || typeof updateTruth.update_available !== 'boolean') {
    throw new Error(`Official Hermes update check returned an invalid result: ${JSON.stringify(updateTruth)}`)
  }

  if (existsSync(diagnosticsPath)) unlinkSync(diagnosticsPath)
  await electronApp.evaluate(({ dialog }, targetPath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: targetPath })
  }, diagnosticsPath)
  await page.getByRole('button', { name: 'צור חבילת אבחון' }).click()
  await page.waitForFunction(
    expectedPath => window.hermesDesktop && document.body.innerText.includes(expectedPath),
    diagnosticsPath,
    { timeout: 30_000 }
  )
  if (!existsSync(diagnosticsPath)) throw new Error('Diagnostics ZIP was not created')
  const diagnosticsZip = new AdmZip(diagnosticsPath)
  const diagnosticEntries = diagnosticsZip.getEntries().map(entry => entry.entryName).sort()
  if (JSON.stringify(diagnosticEntries) !== JSON.stringify(['README.txt', 'diagnostics.json'])) {
    throw new Error(`Diagnostics ZIP contains non-allowlisted files: ${JSON.stringify(diagnosticEntries)}`)
  }
  const diagnosticsManifest = JSON.parse(
    diagnosticsZip.readAsText(diagnosticsZip.getEntry('diagnostics.json'))
  )
  const diagnosticsText = diagnosticEntries
    .map(entryName => diagnosticsZip.readAsText(diagnosticsZip.getEntry(entryName)))
    .join('\n')
  if (
    diagnosticsText.includes(marker) ||
    'sessions' in diagnosticsManifest ||
    'memory' in diagnosticsManifest ||
    'environment' in diagnosticsManifest
  ) {
    throw new Error('Diagnostics bundle leaked conversation or non-allowlisted state')
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        executablePath,
        initial,
        setupUiProbe,
        screenshotPath,
        mini: {
          marker,
          screenshotPath: miniScreenshotPath,
          stopDuringStreaming,
          onboardingProbe,
          approvalProbe,
          windowState,
          windowDetails,
          sharedSession
        },
        integrations: {
          connectionTruth,
          googleFailureProbe,
          skillTruth,
          taskTruth: { id: taskTruth.id, name: taskTruth.name, enabled: taskTruth.enabled, removedAfterProof: true },
          updateTruth,
          diagnostics: { path: diagnosticsPath, entries: diagnosticEntries, manifest: diagnosticsManifest }
        },
        consoleMessages,
        pageErrors
      },
      null,
      2
    )
  )
} finally {
  if (page && originalApprovalMode) {
    await gatewayRpc(page, 'config.set', {
      key: 'approvals.mode',
      value: originalApprovalMode
    }).catch(() => undefined)
  }
  await electronApp.close()
}
