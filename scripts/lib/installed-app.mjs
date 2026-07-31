// Playwright/Electron harness helpers for the installed-companion E2E suites.
// Imports playwright-core, so only the installed-app suites should import this.

import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'
import { sanitize } from './e2e-harness.mjs'

/** A fresh, unique user-data dir under the OS temp folder. */
export function tempUserDataDir(prefix = 'hermes-business-e2e') {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}`)
}

/** Launch the installed companion under Playwright's Electron driver. */
export function launchInstalledApp({ executablePath, appDirectory = '', userDataDir, timeout = 120_000 }) {
  return electron.launch({
    executablePath,
    args: [...(appDirectory ? [appDirectory] : []), `--user-data-dir=${userDataDir}`],
    timeout
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

/**
 * JSON-RPC call over the gateway WebSocket from inside the renderer. The whole
 * body runs in the browser context via page.evaluate, so it may only reference
 * `window` and the single serialized `request` argument.
 */
export async function gatewayRpc(page, method, params, { id = 'e2e-config', timeoutMs = 20_000 } = {}) {
  return page.evaluate(async request => {
    const runtime = await window.hermesDesktop.getRuntime()
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(runtime.wsUrl)
      const timer = window.setTimeout(() => {
        socket.close()
        reject(new Error(`Gateway RPC timed out: ${request.method}`))
      }, request.timeoutMs)
      socket.addEventListener('open', () => {
        socket.send(
          JSON.stringify({ jsonrpc: '2.0', id: request.id, method: request.method, params: request.params })
        )
      })
      socket.addEventListener('message', event => {
        const frame = JSON.parse(String(event.data))
        if (frame.id !== request.id) return
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
  }, { method, params, id, timeoutMs })
}

/** Return the runtime `session.list` result from inside the renderer. */
export async function listSessions(
  page,
  { limit = 100, id = 'installed-ui-session-list', timeoutMs = 20_000 } = {}
) {
  return page.evaluate(async request => {
    const runtime = await window.hermesDesktop.getRuntime()
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(runtime.wsUrl)
      const timer = window.setTimeout(() => {
        socket.close()
        reject(new Error('session.list verification timed out'))
      }, request.timeoutMs)
      socket.addEventListener('open', () => {
        socket.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            method: 'session.list',
            params: { limit: request.limit }
          })
        )
      })
      socket.addEventListener('message', event => {
        const frame = JSON.parse(String(event.data))
        if (frame.id !== request.id) return
        window.clearTimeout(timer)
        socket.close()
        resolve(frame.result?.sessions || [])
      })
      socket.addEventListener('error', () => {
        window.clearTimeout(timer)
        reject(new Error('Could not verify the shared Hermes session'))
      })
    })
  }, { limit, id, timeoutMs })
}

/** Find the session whose title or preview contains a unique marker. */
export async function findSessionByMarker(page, marker, options = {}) {
  const sessions = await listSessions(page, options)
  return (
    sessions.find(session => `${session.title || ''} ${session.preview || ''}`.includes(marker)) || null
  )
}

/**
 * Click a left-nav item and, optionally, wait for its screen heading. Passing a
 * `timeout` scopes the heading wait; omitting it uses Playwright's default.
 */
export async function navigateScreen(page, label, { waitHeading = false, headingText, timeout } = {}) {
  await page.locator('.main-nav__item').filter({ hasText: label }).click()
  if (waitHeading) {
    const heading = page.locator('.content-screen h2').filter({ hasText: headingText || label })
    await heading.waitFor(timeout ? { state: 'visible', timeout } : { state: 'visible' })
  }
}

/** The mini-chat composer textbox. */
export function composerLocator(page) {
  return page.getByRole('textbox', { name: 'הודעה לעוזר' })
}

/** The "stop the streamed answer" button. */
export function stopButtonLocator(page) {
  return page.getByRole('button', { name: 'עצור תשובה' })
}
