// Support-and-health probe: exercises the update check (asserting its busy
// state) and generates a diagnostics bundle, verifying the ZIP is allowlisted
// and leaks no conversation or non-allowlisted state.

import { existsSync, unlinkSync } from 'node:fs'
import AdmZip from 'adm-zip'
import { navigateScreen } from '../../installed-app.mjs'
import { pollUntil } from '../../e2e-harness.mjs'

/**
 * @returns `{ updateTruth, diagnostics: { path, entries, manifest } }`.
 */
export async function runSupport(ctx) {
  const { page, electronApp, marker, diagnosticsPath } = ctx

  await navigateScreen(page, 'תמיכה ותקינות')

  const updateButton = page.getByRole('button', { name: 'בדוק עדכון' })
  await updateButton.click()
  await pollUntil(() => updateButton.isDisabled(), {
    timeoutMs: 15_000,
    intervalMs: 100,
    message: 'update button to enter its busy state'
  })
  await page.locator('button.outline-button .spin').waitFor({ state: 'hidden', timeout: 90_000 })
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
  await page.getByText(diagnosticsPath, { exact: false }).waitFor({ state: 'visible', timeout: 30_000 })
  if (!existsSync(diagnosticsPath)) throw new Error('Diagnostics ZIP was not created')

  const diagnosticsZip = new AdmZip(diagnosticsPath)
  const diagnosticEntries = diagnosticsZip.getEntries().map(entry => entry.entryName).sort()
  if (JSON.stringify(diagnosticEntries) !== JSON.stringify(['README.txt', 'diagnostics.json'])) {
    throw new Error(`Diagnostics ZIP contains non-allowlisted files: ${JSON.stringify(diagnosticEntries)}`)
  }
  const diagnosticsManifest = JSON.parse(diagnosticsZip.readAsText(diagnosticsZip.getEntry('diagnostics.json')))
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

  return {
    updateTruth,
    diagnostics: { path: diagnosticsPath, entries: diagnosticEntries, manifest: diagnosticsManifest }
  }
}
