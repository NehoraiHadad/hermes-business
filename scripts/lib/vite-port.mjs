// The Vite dev-server port and the identity of whatever answers on it.
//
// vite.config.ts is the single declaration of `server.port`. Tooling that also
// needs it (the desktop dev launcher) reads it from there instead of restating
// the number — a hard-coded 5173 in a launcher silently stops matching the day
// the config changes, and the launcher then hands Electron whatever unrelated
// process happens to hold the old port.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const VITE_HOST = '127.0.0.1'

/** Distinctive markers of THIS project's index.html as served by its dev server. */
export const VITE_IDENTITY_MARKERS = ['/src/main.tsx', '/@vite/client']

const repoRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))

/** Extract `server.port` from vite.config.ts source. Returns null when absent. */
export function readViteConfigPort(source) {
  const match = /server\s*:\s*\{[^}]*?\bport\s*:\s*(\d{2,5})\b/.exec(String(source))
  return match ? Number(match[1]) : null
}

/** True when a response body came from this project's Vite dev server. */
export function isThisProjectsVite(body) {
  return VITE_IDENTITY_MARKERS.some(marker => String(body).includes(marker))
}

/** VITE_PORT wins; otherwise vite.config.ts is authoritative. Throws if neither. */
export function resolveVitePort({ env = process.env, configPath = path.join(repoRoot, 'vite.config.ts') } = {}) {
  const fromEnv = env.VITE_PORT
  if (fromEnv) {
    if (!/^\d+$/.test(String(fromEnv))) throw new Error(`VITE_PORT must be an integer (got ${fromEnv})`)
    return Number(fromEnv)
  }
  const port = readViteConfigPort(fs.readFileSync(configPath, 'utf8'))
  if (!port) throw new Error(`Could not read server.port from ${configPath}; set VITE_PORT explicitly.`)
  return port
}

export function viteUrl(port, host = VITE_HOST) {
  return `http://${host}:${port}`
}

/**
 * Wait until `url` answers AND the answer is this project's Vite dev server.
 * A foreign responder is reported as such rather than silently accepted.
 */
export async function waitForThisProjectsVite(url, { timeoutMs = 30_000, intervalMs = 250, fetchImpl = fetch } = {}) {
  const deadline = Date.now() + timeoutMs
  let foreignBody = null
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(url)
      if (response.ok) {
        const body = await response.text()
        if (isThisProjectsVite(body)) return { url, identified: true }
        foreignBody = body.slice(0, 200)
      }
    } catch { /* keep polling */ }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  if (foreignBody !== null) {
    throw new Error(
      `Something is already serving ${url}, but it is not this project's Vite dev server ` +
        `(no ${VITE_IDENTITY_MARKERS.join(' / ')} in the response). Free the port or set VITE_PORT.\n` +
        `First bytes: ${foreignBody}`
    )
  }
  throw new Error(`Vite did not become ready on ${url}`)
}
