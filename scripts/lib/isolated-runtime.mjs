// Harness support for booting the PACKAGED companion against an ISOLATED,
// throwaway HERMES_HOME on an isolated loopback port — the QA side of the
// electron/qa-runtime.cjs contract. This module owns the throwaway temp runtime
// (create → own → tear down the temp home, pick an isolated port, arm the QA
// launch env, gate the isolation preconditions). The live/temp profile marker +
// forensic diff live in ./isolated-marker.mjs; nothing here ever touches the live
// profile.

import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// Mirror of the main-process QA contract (electron/qa-runtime.cjs). Kept in sync
// deliberately: the harness must speak the exact env the runtime validates.
export const QA_SENTINEL_ENV = 'HERMES_BUSINESS_QA_RUNTIME'
export const QA_SENTINEL_VALUE = 'isolated-temp-home'
export const QA_HOME_ENV = 'HERMES_BUSINESS_QA_HERMES_HOME'
export const QA_HOST_ENV = 'HERMES_BUSINESS_QA_HOST'
export const QA_PORT_ENV = 'HERMES_BUSINESS_QA_PORT'
const QA_PORT_MIN = 41000
const QA_PORT_MAX = 60000

/** Absolute live/default HERMES_HOME the isolated run must never touch. */
export function liveHermesHome() {
  return process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || '', 'hermes')
    : path.join(os.homedir(), '.hermes')
}

/** Create a fresh, empty temp HERMES_HOME under the OS TEMP root and own it. */
export function createTempHermesHome() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hermes-qa-home-'))
  const real = realpathSync.native(dir)
  const realTmp = realpathSync.native(os.tmpdir())
  if (!real.toLowerCase().startsWith(realTmp.toLowerCase() + path.sep)) {
    throw new Error(`temp home escaped TEMP root: ${real}`)
  }
  const live = path.resolve(liveHermesHome()).toLowerCase()
  if (real.toLowerCase() === live || real.toLowerCase().startsWith(live + path.sep)) {
    throw new Error(`temp home resolved into the live profile: ${real}`)
  }
  return real
}

/** Pick a free loopback port inside the QA-allowed safe high range. */
export async function chooseIsolatedPort(preferred = 47100) {
  const start = Math.min(Math.max(preferred, QA_PORT_MIN), QA_PORT_MAX - 50)
  for (let port = start; port < QA_PORT_MAX; port += 1) {
    if (await isPortFree(port)) return port
  }
  throw new Error('no free port in the QA safe range')
}

/** True when nothing is listening on 127.0.0.1:port. */
export function isPortFree(port) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })
}

/** The env overlay a launcher merges over process.env to arm the QA contract. */
export function isolatedLaunchEnv({ home, port, host = '127.0.0.1' }) {
  if (port < QA_PORT_MIN || port > QA_PORT_MAX) {
    throw new Error(`isolated port ${port} is outside the QA safe range`)
  }
  return {
    [QA_SENTINEL_ENV]: QA_SENTINEL_VALUE,
    [QA_HOME_ENV]: home,
    [QA_HOST_ENV]: host,
    [QA_PORT_ENV]: String(port)
  }
}

/** Canonical, case-folded comparison key for a home/dir path. */
function homeKey(p) {
  if (!p) return null
  return path.resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase()
}

/**
 * Fail-fast isolation invariants that MUST all hold BEFORE any session create,
 * prompt submit, credential seed, provider call, guarded action or approval.
 *
 * This is the guard that stops a SILENT isolation failure — e.g. an Electron
 * single-instance/userData collision that forwarded the launch to the running
 * live gateway — from escalating into a live-profile mutation. If any check is
 * not strictly true the caller aborts immediately with no side effects and tears
 * down. Returns { ok, failed:[key...], checks:{...} }.
 *
 *  - runtime_mode must equal 'qa-isolated'
 *  - the WS/health port must equal the isolated port
 *  - the diagnostics HERMES_HOME must be the throwaway temp home
 *  - the isolated baseline session count must be exactly 0
 */
export function evaluateIsolationPreconditions({
  runtimeMode,
  wsPort,
  isolatedPort,
  diagnosticsHome,
  tempHome,
  isolatedSessionCount
}) {
  const checks = {
    runtime_mode_qa_isolated: runtimeMode === 'qa-isolated',
    ws_on_isolated_port:
      Number.isInteger(Number(wsPort)) && Number(wsPort) === Number(isolatedPort),
    diagnostics_home_is_temp: Boolean(diagnosticsHome) && homeKey(diagnosticsHome) === homeKey(tempHome),
    isolated_session_count_zero: isolatedSessionCount === 0
  }
  const failed = Object.entries(checks)
    .filter(([, value]) => value !== true)
    .map(([key]) => key)
  return { ok: failed.length === 0, failed, checks }
}

/** Remove a temp home we created; tolerate locks from a just-stopped process. */
export function removeTempHome(home) {
  if (!home || !existsSync(home)) return { removed: true }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(home, { recursive: true, force: true, maxRetries: 3 })
      if (!existsSync(home)) return { removed: true }
    } catch {
      /* retry after a beat */
    }
    spawnSync(process.platform === 'win32' ? 'cmd' : 'sleep', process.platform === 'win32' ? ['/c', 'ping', '-n', '2', '127.0.0.1'] : ['0.3'], { stdio: 'ignore' })
  }
  return { removed: !existsSync(home) }
}
