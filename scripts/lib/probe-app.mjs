// One boot sequence for every installed-companion UI probe.
//
// The four packaged-UI probes (whatsapp, partner, attachment, update) each used
// to hand-roll the same ~20 lines: resolve the executable by re-deriving the
// LOCALAPPDATA path, launch Electron with a `--user-data-dir` under TEMP, open
// the first window, stamp the onboarding-complete key, reload, wait for
// `.app-shell` — and then NEVER remove the temp profile, leaking a directory into
// %TEMP% on every single run.
//
// `withProbeApp` owns all of it, including a guaranteed try/finally teardown that
// deletes the throwaway profile (with the Windows file-lock retry idiom from
// ./isolated-runtime.mjs). Intentional per-probe differences are options, not
// forks: the attachment probe enters demo mode by navigating to `?demo=1` instead
// of reloading, the missing-Hermes probe brings its own executable/env and never
// completes onboarding or waits for the shell.

import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveInstalledExecutable, sanitize } from './e2e-harness.mjs'
import { launchInstalledApp } from './installed-app.mjs'
import { removeTempHome } from './isolated-runtime.mjs'

/** localStorage key the renderer uses to remember onboarding was finished. */
export const ONBOARDING_STORAGE_KEY = 'hermes-business-onboarding-v1'

/** A fresh, unique throwaway Electron profile directory under the OS TEMP root. */
export function probeUserDataDir(prefix) {
  if (!prefix) throw new Error('probeUserDataDir requires a prefix')
  return path.join(os.tmpdir(), `${prefix}-${process.pid}-${Date.now()}`)
}

/**
 * Delete a throwaway profile. Refuses anything that is not under the OS TEMP
 * root, so a mis-passed path can never delete real user data.
 */
export async function removeProbeUserData(dir) {
  if (!dir || !existsSync(dir)) return { removed: true }
  const key = value => path.resolve(String(value)).replace(/[\\/]+$/, '').toLowerCase()
  if (!key(dir).startsWith(key(os.tmpdir()) + path.sep.toLowerCase())) {
    return { removed: false, refused: `not under the OS TEMP root: ${dir}` }
  }
  return removeTempHome(dir)
}

/**
 * Launch the installed companion for a UI probe and hand the caller a ready page.
 *
 * @param {object} options
 * @param {string} options.prefix              temp profile prefix (required)
 * @param {string} [options.executablePath]    defaults to resolveInstalledExecutable()
 * @param {string} [options.appDirectory]
 * @param {object} [options.env]               FULL child environment (Playwright replaces, never merges)
 * @param {object} [options.safetyEnv]         env the isolation gate is asserted against (default process.env)
 * @param {boolean}[options.completeOnboarding=true]
 * @param {'reload'|'demo'|'none'} [options.boot='reload'] how to enter the app shell after stamping onboarding
 * @param {boolean}[options.waitForShell=true]
 * @param {boolean}[options.collectErrors=false] collect redacted renderer console errors / page errors
 */
export async function launchProbeApp({
  prefix,
  executablePath,
  appDirectory,
  env,
  safetyEnv,
  completeOnboarding = true,
  boot = 'reload',
  waitForShell = true,
  collectErrors = false,
  launchTimeoutMs = 120_000,
  windowTimeoutMs = 60_000,
  shellTimeoutMs = 90_000
} = {}) {
  if (!executablePath) {
    const resolved = resolveInstalledExecutable()
    executablePath = resolved.executablePath
    appDirectory = appDirectory ?? resolved.appDirectory
  } else if (!existsSync(executablePath)) {
    throw new Error(`Installed companion was not found: ${executablePath}`)
  }

  const userDataDir = probeUserDataDir(prefix)
  const app = await launchInstalledApp({
    executablePath,
    appDirectory: appDirectory || '',
    userDataDir,
    timeout: launchTimeoutMs,
    env,
    safetyEnv
  })

  const consoleErrors = []
  const pageErrors = []
  let page
  try {
    page = await app.firstWindow({ timeout: windowTimeoutMs })
    if (collectErrors) {
      page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(sanitize(message.text()))
      })
      page.on('pageerror', error => pageErrors.push(sanitize(String(error?.stack || error))))
    }
    await page.waitForLoadState('domcontentloaded')

    // Capture the entry URL before any navigation so `?demo=1` targets the same
    // packaged bundle rather than a guessed path.
    const baseUrl = boot === 'demo' ? await page.evaluate(() => location.href.split('?')[0]) : null

    if (completeOnboarding) {
      await page.evaluate(key => localStorage.setItem(key, 'complete'), ONBOARDING_STORAGE_KEY)
    }
    if (boot === 'demo') {
      // Demo transport: deterministic, no live Hermes runtime required.
      await page.goto(`${baseUrl}?demo=1`, { waitUntil: 'domcontentloaded' })
    } else if (boot === 'reload') {
      await page.reload({ waitUntil: 'domcontentloaded' })
    }
    if (waitForShell) {
      await page.locator('.app-shell').waitFor({ state: 'visible', timeout: shellTimeoutMs })
    }
  } catch (error) {
    await app.close().catch(() => undefined)
    await removeProbeUserData(userDataDir)
    throw error
  }

  return { app, page, userDataDir, consoleErrors, pageErrors }
}

/**
 * `launchProbeApp` with a guaranteed teardown: the app is closed and the
 * throwaway profile deleted whether the body passes, throws, or the process is
 * unwinding. Returns whatever `body` returns.
 */
export async function withProbeApp(options, body) {
  const probe = await launchProbeApp(options)
  try {
    return await body(probe)
  } finally {
    await probe.app.close().catch(() => undefined)
    const cleanup = await removeProbeUserData(probe.userDataDir)
    if (!cleanup.removed) {
      console.warn(`WARNING: could not remove the throwaway profile ${probe.userDataDir}${cleanup.refused ? ` (${cleanup.refused})` : ''}`)
    }
  }
}

/** Throw if the renderer logged any error during the probe. */
export function assertNoRendererErrors({ consoleErrors, pageErrors }, context = 'the probe') {
  if (consoleErrors.length || pageErrors.length) {
    throw new Error(`Renderer errors during ${context}: ${JSON.stringify({ consoleErrors, pageErrors })}`)
  }
}
