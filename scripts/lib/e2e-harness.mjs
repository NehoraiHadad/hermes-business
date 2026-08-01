// Shared, environment-agnostic primitives for the Hermes business E2E suites.
//
// This module is the single entry point for cross-cutting harness concerns:
// redaction, executable/binary resolution, health polling, condition polling
// and retry. Environment-specific harness pieces that require heavy imports
// (Playwright for the installed app, child_process for a live Hermes server)
// live in ./installed-app.mjs and ./hermes-live.mjs so that importing this
// core never drags in a toolkit a given suite does not use.

import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Redact secrets from any string before it reaches stdout, stderr or a
 * collected log buffer. Covers query-string tokens/tickets/codes, HTTP
 * Authorization headers, JSON-ish secret fields, the well-known key shapes
 * (OpenAI `sk-`, Google `AIza`, Telegram bot tokens) and email addresses.
 * Idempotent: running it twice, or on already-clean text, yields the same
 * string, so it is safe to apply both at capture time and again on the final
 * serialized payload.
 *
 * Email handling preserves the domain (useful technical/routing data) while
 * eliminating the user/customer identity in the local part:
 * `jane.doe@shop.co.il` becomes `<redacted>@shop.co.il`. The placeholder ends
 * in `>` so the local-part class never abuts the surviving `@`, keeping the
 * pass idempotent. The canonical email pattern is mirrored in
 * `electron/redact.cjs` for production diagnostics.
 */
export function sanitize(value) {
  return String(value || '')
    .replace(
      /([?&](?:token|ticket|code|secret|api[_-]?key|access_token|refresh_token|password)=)[^&\s]+/gi,
      '$1<redacted>'
    )
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{8,}=*/g, '$1 <redacted>')
    .replace(
      /(["']?(?:token|ticket|secret|api[_-]?key|access_token|refresh_token|password|session_token)["']?\s*[:=]\s*["'])[^"']+(["'])/gi,
      '$1<redacted>$2'
    )
    .replace(
      /\b(sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|\d{7,}:[A-Za-z0-9_-]{20,})\b/g,
      '<redacted>'
    )
    .replace(/[A-Za-z0-9._%+-]+@([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g, '<redacted>@$1')
}

/** Serialize a value to pretty JSON with every secret redacted. */
export function safeJson(value) {
  return sanitize(JSON.stringify(value, null, 2))
}

/** Resolve after `ms` milliseconds. */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Poll `check` until it returns a truthy value or the deadline passes. Replaces
 * arbitrary `waitForTimeout` sleeps with an explicit condition. Returns the
 * truthy value; throws a descriptive timeout otherwise.
 */
export async function pollUntil(check, { timeoutMs = 30_000, intervalMs = 100, message = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const result = await check()
    if (result) return result
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${message}`)
    await sleep(intervalMs)
  }
}

/** Retry an async operation a bounded number of times with a fixed backoff. */
export async function withRetry(fn, { attempts = 3, delayMs = 500, onError } = {}) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt)
    } catch (error) {
      lastError = error
      if (onError) onError(error, attempt)
      if (attempt < attempts) await sleep(delayMs)
    }
  }
  throw lastError
}

/** Locate the installed companion executable, honoring the opt-in env contract. */
export function resolveInstalledExecutable() {
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
  return { executablePath, appDirectory }
}

/** Locate the Hermes agent binary and home directory for the live suite. */
export function resolveHermesBinary() {
  const hermesHome =
    process.env.HERMES_HOME ||
    (process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA || '', 'hermes')
      : path.join(process.env.HOME || '', '.hermes'))
  const hermes =
    process.env.HERMES_BIN ||
    (process.platform === 'win32'
      ? path.join(hermesHome, 'hermes-agent', 'venv', 'Scripts', 'hermes.exe')
      : path.join(hermesHome, 'hermes-agent', 'venv', 'bin', 'hermes'))
  if (!existsSync(hermes)) {
    throw new Error(`Hermes executable was not found at ${hermes}`)
  }
  return { hermes, hermesHome }
}

/** Poll the Hermes `/api/health` endpoint until it returns HTTP 200. */
export async function waitForHealth(baseUrl, token, { timeoutMs = 60_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (response.ok) return response.json()
      lastError = new Error(`Health returned HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await sleep(intervalMs)
  }
  throw lastError || new Error('Hermes health check timed out')
}
