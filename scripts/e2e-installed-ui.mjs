// Installed-companion UI acceptance test. Orchestrator only: each screen's
// checks live in scripts/lib/probes/installed/* and the reusable Electron and
// redaction machinery lives in scripts/lib/*. Behavior and JSON report shape
// are preserved from the original single-file script.

import os from 'node:os'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { assertSafeInstalledE2E } from './lib/e2e-safety.mjs'
import { resolveInstalledExecutable, safeJson } from './lib/e2e-harness.mjs'
import {
  gatewayRpc,
  launchInstalledApp,
  openFirstWindow,
  tempUserDataDir
} from './lib/installed-app.mjs'
import { clearRestoreJournal, recoverPendingRestore } from './lib/live-restore-journal.mjs'
import { removeProbeUserData } from './lib/probe-app.mjs'
import { APPROVAL_MODE_JOURNAL } from './lib/probes/installed/approval.mjs'
import { verifyBoot } from './lib/probes/installed/boot.mjs'
import { runSetupWizard } from './lib/probes/installed/setup-wizard.mjs'
import { runMiniChat } from './lib/probes/installed/mini-chat.mjs'
import { runOnboardingClarify } from './lib/probes/installed/onboarding-clarify.mjs'
import { runApproval } from './lib/probes/installed/approval.mjs'
import { runConnections } from './lib/probes/installed/connections.mjs'
import { runSkills } from './lib/probes/installed/skills.mjs'
import { runTasks } from './lib/probes/installed/tasks.mjs'
import { runSupport } from './lib/probes/installed/support.mjs'

// Prove isolation BEFORE resolving or launching anything. A restore journal
// belongs to the profile it was captured from: the isolated QA home, or the
// operator's live profile under the disposable-host hatch.
const safety = assertSafeInstalledE2E()
const approvalScope = safety.home || 'live-profile'

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
  originalApprovalMode: null,
  approvalScope
}

const userDataDir = tempUserDataDir()
const electronApp = await launchInstalledApp({
  executablePath,
  appDirectory,
  userDataDir
})

// The approval probe flips the LIVE `approvals.mode` config key. Reading back a
// journal left by an interrupted earlier run — and putting the value back before
// anything else touches it — is the crash-safe half of that mutation; see
// APPROVAL_MODE_RESTORE below and scripts/lib/live-restore-journal.mjs.
const approvalModeRestore = page => ({
  key: APPROVAL_MODE_JOURNAL,
  label: 'the live approvals.mode',
  scope: approvalScope,
  capture: async () => (await gatewayRpc(page, 'config.get', { key: 'approvals.mode' }))?.value || 'manual',
  restore: value => gatewayRpc(page, 'config.set', { key: 'approvals.mode', value })
})

try {
  const { page, consoleMessages, pageErrors } = await openFirstWindow(electronApp)
  Object.assign(ctx, { page, electronApp, consoleMessages, pageErrors })

  // Crash recovery FIRST: before any probe mutates live state again.
  await recoverPendingRestore(APPROVAL_MODE_JOURNAL, approvalModeRestore(page))

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
  let restoreError = null
  if (ctx.page && ctx.originalApprovalMode) {
    // Loud, verified restore: put the live value back, READ IT BACK, and only
    // then drop the journal. A silent `.catch(() => undefined)` here used to hide
    // a permanently-relaxed approvals.mode on the operator's real profile.
    const spec = approvalModeRestore(ctx.page)
    try {
      await spec.restore(ctx.originalApprovalMode)
      const readback = await spec.capture()
      if (readback !== ctx.originalApprovalMode) {
        throw new Error(`approvals.mode reads back as ${readback}, expected ${ctx.originalApprovalMode}`)
      }
      clearRestoreJournal(APPROVAL_MODE_JOURNAL)
    } catch (error) {
      restoreError = error
    }
  }
  await electronApp.close()
  await removeProbeUserData(userDataDir)
  if (restoreError) {
    console.error(
      `FAILED to restore the live approvals.mode to "${ctx.originalApprovalMode}": ` +
        `${restoreError?.message || restoreError}. The restore journal is KEPT — re-run this suite to retry.`
    )
    process.exitCode = 1
  }
}
