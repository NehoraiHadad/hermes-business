const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Path/host/port POLICY for the main-process QA runtime override
// (electron/qa-runtime.cjs) — the fail-closed validators, split out so the
// resolver stays thin. SECURITY / TRUST MODEL: deliberately fail-closed.
// Validators read ONLY the passed (main-process) env; no IPC/preload path lets
// renderer content set them. The isolated home must be an absolute, canonical
// (realpath-resolved), EMPTY, newly-created dir strictly under the OS TEMP root
// (symlink/reparse escapes defeated via realpath + a symlinked-leaf reject),
// never the live/default HERMES_HOME. Host is pinned to loopback; port to a safe
// high range excluding the default gateway. ANY failure THROWS QaOverrideError.

const SENTINEL_ENV = 'HERMES_BUSINESS_QA_RUNTIME'
const SENTINEL_VALUE = 'isolated-temp-home'
const HOME_ENV = 'HERMES_BUSINESS_QA_HERMES_HOME'
const HOST_ENV = 'HERMES_BUSINESS_QA_HOST'
const PORT_ENV = 'HERMES_BUSINESS_QA_PORT'

const ALLOWED_HOST = '127.0.0.1'
const PORT_MIN = 41000
const PORT_MAX = 60000
const DEFAULT_GATEWAY_PORT = 9119

class QaOverrideError extends Error {
  constructor(message) {
    super(message)
    this.name = 'QaOverrideError'
    this.code = 'QA_OVERRIDE_INVALID'
  }
}

const winCI = process.platform === 'win32'
function normCompare(value) {
  const trimmed = String(value).replace(/[\\/]+$/, '')
  return winCI ? trimmed.toLowerCase() : trimmed
}
function isUnder(child, parent) {
  const c = normCompare(child)
  const p = normCompare(parent)
  return c === p || c.startsWith(p + normCompare(path.sep))
}

/** Absolute default/live HERMES_HOME(s) that must never be used as a QA home. */
function liveHomeCandidates(env) {
  const homes = []
  if (env.HERMES_HOME) homes.push(env.HERMES_HOME)
  if (process.platform === 'win32') {
    if (env.LOCALAPPDATA) homes.push(path.join(env.LOCALAPPDATA, 'hermes'))
  } else {
    homes.push(path.join(os.homedir(), '.hermes'))
  }
  return homes
}

/** Validate HERMES_BUSINESS_QA_HERMES_HOME and return its canonical realpath, or
 * throw: an absolute, non-symlink, EMPTY dir strictly under the OS TEMP root and
 * never the live/default HERMES_HOME. */
function validateIsolatedHome(env) {
  const rawHome = env[HOME_ENV]
  if (!rawHome || typeof rawHome !== 'string' || !path.isAbsolute(rawHome)) {
    throw new QaOverrideError(`${HOME_ENV} must be set to an absolute path`)
  }
  // Reject a symlinked leaf outright, then resolve the canonical realpath so any
  // reparse/symlink chain that escapes TEMP is caught by the containment check.
  let leafStat
  try {
    leafStat = fs.lstatSync(rawHome)
  } catch {
    throw new QaOverrideError(`${HOME_ENV} must be an existing, newly-created directory`)
  }
  if (leafStat.isSymbolicLink()) {
    throw new QaOverrideError(`${HOME_ENV} must not be a symlink/reparse point`)
  }
  if (!leafStat.isDirectory()) {
    throw new QaOverrideError(`${HOME_ENV} must be a directory`)
  }
  let realHome, realTmp
  try {
    realHome = fs.realpathSync.native(rawHome)
    realTmp = fs.realpathSync.native(os.tmpdir())
  } catch {
    throw new QaOverrideError(`${HOME_ENV} could not be canonicalized`)
  }
  if (normCompare(realHome) === normCompare(realTmp) || !isUnder(realHome, realTmp)) {
    throw new QaOverrideError(`${HOME_ENV} must be a directory strictly under the system TEMP root`)
  }
  for (const live of liveHomeCandidates(env)) {
    let realLive
    try {
      realLive = fs.existsSync(live) ? fs.realpathSync.native(live) : path.resolve(live)
    } catch {
      realLive = path.resolve(live)
    }
    if (isUnder(realHome, realLive)) {
      throw new QaOverrideError(`${HOME_ENV} must not be the live/default HERMES_HOME`)
    }
  }
  let entries
  try {
    entries = fs.readdirSync(realHome)
  } catch {
    throw new QaOverrideError(`${HOME_ENV} could not be read`)
  }
  if (entries.length !== 0) {
    throw new QaOverrideError(`${HOME_ENV} must be an EMPTY, newly-created directory`)
  }
  return realHome
}

/** Validate the host (defaults to loopback) — must be exactly 127.0.0.1. */
function validateHost(env) {
  const host = env[HOST_ENV] || ALLOWED_HOST
  if (host !== ALLOWED_HOST) {
    throw new QaOverrideError(`${HOST_ENV} must be ${ALLOWED_HOST}`)
  }
  return host
}

/** Validate the port — a safe-high-range integer, never the default gateway. */
function validatePort(env) {
  const rawPort = env[PORT_ENV]
  if (!rawPort || !/^\d+$/.test(String(rawPort))) {
    throw new QaOverrideError(`${PORT_ENV} must be an integer`)
  }
  const port = Number(rawPort)
  if (port === DEFAULT_GATEWAY_PORT || port < PORT_MIN || port > PORT_MAX) {
    throw new QaOverrideError(
      `${PORT_ENV} must be in the safe range ${PORT_MIN}-${PORT_MAX} (not the default ${DEFAULT_GATEWAY_PORT})`
    )
  }
  return port
}

module.exports = {
  SENTINEL_ENV,
  SENTINEL_VALUE,
  HOME_ENV,
  HOST_ENV,
  PORT_ENV,
  ALLOWED_HOST,
  PORT_MIN,
  PORT_MAX,
  DEFAULT_GATEWAY_PORT,
  QaOverrideError,
  validateIsolatedHome,
  validateHost,
  validatePort
}
