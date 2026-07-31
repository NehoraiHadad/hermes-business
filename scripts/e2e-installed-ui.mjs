// Installed-companion UI acceptance test. Orchestrator only: each screen's
// checks live in scripts/lib/probes/installed/* and the reusable Electron and
// redaction machinery lives in scripts/lib/*. Behavior and JSON report shape
// are preserved from the original single-file script.

import os from 'node:os'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { resolveInstalledExecutable, safeJson } from './lib/e2e-harness.mjs'
import {
  gatewayRpc,
  launchInstalledApp,
  openFirstWindow,
  tempUserDataDir
} from './lib/installed-app.mjs'
import { verifyBoot } from './lib/probes/installed/boot.mjs'
import { runSetupWizard } from './lib/probes/installed/setup-wizard.mjs'
import { runMiniChat } from './lib/probes/installed/mini-chat.mjs'
import { runOnboardingClarify } from './lib/probes/installed/onboarding-clarify.mjs'
import { runApproval } from './lib/probes/installed/approval.mjs'
import { runConnections } from './lib/probes/installed/connections.mjs'
import { runSkills } from './lib/probes/installed/skills.mjs'
import { runTasks } from './lib/probes/installed/tasks.mjs'
import { runSupport } from './lib/probes/installed/support.mjs'

const projectRoot = path.resolve(import.meta.dirname, '..')
const { executablePath, appDirectory } = resolveInstalledExecutable()

const artifactDirectory = path.join(projectRoot, 'release')
mkdirSync(artifactDirectory, { recursive: true })

const ctx = {
  executablePath,
  screenshotPath: path.join(artifactDirectory, 'e2e-installed-ui.png'),
  miniScreenshotPath: path.join(artifactDirectory, 'e2e-installed-mini-chat.png'),
  marker: `INSTALLED_MINI_E2E_OK_${Date.now()}`,
  taskName: `בדיקת POC ${Date.now()}`,
  durableSkillName: 'poc-weekly-lead-summary',
  approvalProbePath: path.join(os.tmpdir(), `hermes-business-approval-probe-${Date.now()}.txt`),
  diagnosticsPath: path.join(os.tmpdir(), `hermes-business-diagnostics-e2e-${Date.now()}.zip`),
  runApprovalProbe: process.env.HERMES_BUSINESS_E2E_APPROVAL === '1',
  runOnboardingProbe: process.env.HERMES_BUSINESS_E2E_ONBOARDING !== '0',
  originalApprovalMode: null
}

const electronApp = await launchInstalledApp({
  executablePath,
  appDirectory,
  userDataDir: tempUserDataDir()
})

try {
  const { page, consoleMessages, pageErrors } = await openFirstWindow(electronApp)
  Object.assign(ctx, { page, electronApp, consoleMessages, pageErrors })

  const initial = await verifyBoot(ctx)
  const setupUiProbe = await runSetupWizard(ctx)
  const mini = await runMiniChat(ctx)
  const onboardingProbe = await runOnboardingClarify(ctx)
  const approvalProbe = await runApproval(ctx)
  await page.screenshot({ path: ctx.miniScreenshotPath })

  await page.getByRole('button', { name: 'פתח חלון מלא' }).click()
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 30_000 })

  const { connectionTruth, googleFailureProbe } = await runConnections(ctx)
  const skillTruth = await runSkills(ctx)
  const taskTruth = await runTasks(ctx)
  const { updateTruth, diagnostics } = await runSupport(ctx)

  console.log(
    safeJson({
      ok: true,
      executablePath,
      initial,
      setupUiProbe,
      screenshotPath: ctx.screenshotPath,
      mini: {
        marker: mini.marker,
        screenshotPath: ctx.miniScreenshotPath,
        stopDuringStreaming: mini.stopDuringStreaming,
        onboardingProbe,
        approvalProbe,
        windowState: mini.windowState,
        windowDetails: mini.windowDetails,
        sharedSession: mini.sharedSession
      },
      integrations: {
        connectionTruth,
        googleFailureProbe,
        skillTruth,
        taskTruth: { id: taskTruth.id, name: taskTruth.name, enabled: taskTruth.enabled, removedAfterProof: true },
        updateTruth,
        diagnostics
      },
      consoleMessages,
      pageErrors
    })
  )
} finally {
  if (ctx.page && ctx.originalApprovalMode) {
    await gatewayRpc(ctx.page, 'config.set', {
      key: 'approvals.mode',
      value: ctx.originalApprovalMode
    }).catch(() => undefined)
  }
  await electronApp.close()
}
