// Isolated-runtime resolver for the installed-Hermes shared-state E2E.
//
// Two invariants this module enforces so the suite never touches the user's
// real Hermes profile/state:
//   1. The *binary* is resolved from the installed tree, INDEPENDENTLY of
//      HERMES_HOME (unlike resolveHermesBinary in e2e-harness.mjs, which
//      couples them). We run the official code, not a copy.
//   2. HERMES_HOME is ALWAYS a fresh temp directory. If a caller points
//      HERMES_E2E_HOME at the live profile we refuse to start.

import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Absolute path of the *live* user Hermes home we must never mutate. */
export function liveHermesHome() {
  return process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || '', 'hermes')
    : path.join(process.env.HOME || '', '.hermes')
}

/** Root of the officially installed Hermes checkout (holds the venv + code). */
export function installedHermesRoot() {
  return process.env.HERMES_INSTALL_ROOT || path.join(liveHermesHome(), 'hermes-agent')
}

/**
 * Resolve the installed `hermes` executable without reference to HERMES_HOME.
 * The venv binary carries the real runtime, gateway and REST routers.
 */
export function resolveInstalledHermes() {
  const root = installedHermesRoot()
  const hermes =
    process.env.HERMES_BIN ||
    (process.platform === 'win32'
      ? path.join(root, 'venv', 'Scripts', 'hermes.exe')
      : path.join(root, 'venv', 'bin', 'hermes'))
  if (!existsSync(hermes)) {
    throw new Error(`Installed Hermes binary not found at ${hermes}`)
  }
  return { hermes, installRoot: root }
}

/** Resolve two paths to the same location, case-insensitively on win32. */
function samePath(a, b) {
  if (!a || !b) return false
  const norm = p => path.resolve(p).replace(/[\\/]+$/, '')
  const x = norm(a)
  const y = norm(b)
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
}

/** Throw if `home` is (or is inside) the live user Hermes profile. */
export function assertNotLiveHome(home) {
  const live = liveHermesHome()
  const resolved = path.resolve(home)
  if (samePath(resolved, live) || resolved.toLowerCase().startsWith(path.resolve(live).toLowerCase() + path.sep)) {
    throw new Error(`Refusing to run against the live Hermes home: ${resolved}`)
  }
  return resolved
}

/**
 * Create (or adopt) an isolated HERMES_HOME. An explicit HERMES_E2E_HOME is
 * honored only after the live-home guard passes; otherwise a fresh mkdtemp
 * directory is created so parallel runs never collide.
 */
export function createIsolatedHome() {
  const explicit = process.env.HERMES_E2E_HOME
  if (explicit) return assertNotLiveHome(explicit)
  const home = mkdtempSync(path.join(tmpdir(), 'hermes-e2e-home-'))
  return assertNotLiveHome(home)
}

/**
 * Environment overlay that keeps the spawned server headless and offline:
 * no external channel (WhatsApp/Telegram/email/Google) may start, and no
 * update/telemetry callouts run. An isolated empty home already carries no
 * channel credentials, so these flags are belt-and-suspenders.
 */
export function offlineChannelEnv() {
  return {
    HERMES_DESKTOP: '1',
    WHATSAPP_ENABLED: '0',
    TELEGRAM_ENABLED: '0',
    DISCORD_ENABLED: '0',
    SLACK_ENABLED: '0',
    SIGNAL_ENABLED: '0',
    EMAIL_ENABLED: '0',
    IMESSAGE_ENABLED: '0',
    HERMES_DISABLE_UPDATE_CHECK: '1',
    HERMES_NO_UPDATE_CHECK: '1',
    HERMES_TELEMETRY_DISABLED: '1',
    DO_NOT_TRACK: '1'
  }
}
