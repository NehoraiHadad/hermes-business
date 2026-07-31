// Thin REST client for the Hermes dashboard HTTP surface. This is the exact
// transport the business companion (the "wrapper") uses via
// src/lib/hermes/rest*.ts: `/api/cron/jobs`, `/api/skills`, `/api/sessions`,
// all authenticated with the same Bearer session token as the WebSocket
// gateway. Keeping it separate proves those REST calls and the WS RPC calls
// hit one server / one HERMES_HOME.

import { sanitize } from './e2e-harness.mjs'

const DEFAULT_PROFILE = 'default'

/** Append `?profile=default`, matching src/lib/hermes/core.ts withProfile. */
export function withProfile(pathname, profile = DEFAULT_PROFILE) {
  const sep = pathname.includes('?') ? '&' : '?'
  return `${pathname}${sep}profile=${encodeURIComponent(profile)}`
}

/**
 * Build a REST caller bound to one base URL + token. Returns parsed JSON (or
 * null for empty 2xx bodies) and throws a redacted error on non-2xx.
 */
export function createRestClient({ baseUrl, token }) {
  return async function rest(method, pathname, body) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(sanitize(`REST ${method} ${pathname} -> HTTP ${response.status}: ${text.slice(0, 400)}`))
    }
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
}
