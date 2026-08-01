// App launch + window/runtime lifecycle for the installed-companion E2E suites.
// Imports playwright-core, so only the installed-app suites should import this.

import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { sanitize } from './e2e-harness.mjs'

/** A fresh, unique user-data dir under the OS temp folder. */
export function tempUserDataDir(prefix = 'hermes-business-e2e') {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}`)
}

/** Launch the installed companion under Playwright's Electron driver. An
 * optional `env` fully replaces the child environment (Playwright semantics), so
 * callers that need overrides must spread process.env themselves. */
export function launchInstalledApp({ executablePath, appDirectory = '', userDataDir, timeout = 120_000, env }) {
  return electron.launch({
    executablePath,
    args: [...(appDirectory ? [appDirectory] : []), `--user-data-dir=${userDataDir}`],
    timeout,
    ...(env ? { env } : {})
  })
}

/**
 * Open the first renderer window and attach redacted log collectors. Console
 * messages and page errors are sanitized as they are captured so no raw secret
 * can leak into the buffers or any error that later interpolates them.
 */
export async function openFirstWindow(electronApp, { timeout = 60_000 } = {}) {
  const page = await electronApp.firstWindow({ timeout })
  const consoleMessages = []
  const pageErrors = []
  page.on('console', message => consoleMessages.push(sanitize(`[${message.type()}] ${message.text()}`)))
  page.on('pageerror', error => pageErrors.push(sanitize(String(error?.stack || error))))
  return { page, consoleMessages, pageErrors }
}

/** Read the isolated runtime state from the renderer bridge. */
export async function readRuntimeState(page) {
  return page.evaluate(() => window.hermesDesktop.getRuntime())
}

/** Wait until the renderer reports the runtime is running (post start/restart). */
export async function waitForRuntimeRunning(page, { timeoutMs = 60_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const state = await page.evaluate(() => window.hermesDesktop.getRuntime())
    if (state && state.running) return state
    if (Date.now() >= deadline) return state
    await new Promise(r => setTimeout(r, intervalMs))
  }
}
