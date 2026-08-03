const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  resolveQaRuntimeOverride,
  getQaRuntimeOverride,
  __resetQaRuntimeOverrideCache
} = require('./qa-runtime.cjs')
const { isUnder: isUnderShared } = require('./path-containment.cjs')

const DEV_SENTINEL_ENV = 'HERMES_BUSINESS_DEV_RUNTIME'
const DEV_SENTINEL_VALUE = 'isolated-dev-home'
const DEV_HOME_ENV = 'HERMES_BUSINESS_DEV_HERMES_HOME'
const DEV_BINARY_ENV = 'HERMES_BUSINESS_HERMES_EXE'
const DEV_PORT_ENV = 'HERMES_BUSINESS_DEV_PORT'
const PROD_HOME_ENV = 'HERMES_BUSINESS_HOME'
const PROD_PORT = 9119
const DEV_PORT = 19119

class RuntimeModeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RuntimeModeError'
    this.code = 'RUNTIME_MODE_INVALID'
  }
}

function defaultLiveHome(env = process.env) {
  if (process.platform === 'win32') {
    return path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'hermes')
  }
  return path.join(os.homedir(), '.hermes')
}

function defaultDevRoot(env = process.env) {
  const base = process.platform === 'win32'
    ? env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    : env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state')
  return path.join(base, 'hermes-business-dev')
}

// Containment checks share the canonical separator-aware primitive; inputs here
// may still be relative or trailing-separator-suffixed env values, so they are
// resolved to absolute form first (path-containment compares as-given).
function isUnder(child, parent) {
  return isUnderShared(path.resolve(String(child || '')), path.resolve(String(parent || '')))
}

function isTestPath(value, env = process.env) {
  if (!value) return false
  const resolved = path.resolve(String(value))
  const temp = path.resolve(String(env.TEMP || env.TMP || os.tmpdir()))
  return isUnder(resolved, temp) && /hermes-(business-e2e|qa-home|e2e-home)/i.test(resolved)
}

function absoluteEnvPath(env, name, fallback) {
  const value = String(env[name] || fallback || '').trim()
  if (!value || !path.isAbsolute(value)) {
    throw new RuntimeModeError(`${name} must be an absolute path`)
  }
  return path.resolve(value)
}

function devConfig(env) {
  const root = defaultDevRoot(env)
  const home = absoluteEnvPath(env, DEV_HOME_ENV, path.join(root, 'hermes-home'))
  const live = defaultLiveHome(env)
  if (isUnder(home, live) || isUnder(live, home)) {
    throw new RuntimeModeError(`${DEV_HOME_ENV} must be disjoint from the live Hermes home`)
  }
  const rawPort = String(env[DEV_PORT_ENV] || DEV_PORT)
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 19000 || Number(rawPort) > 20999) {
    throw new RuntimeModeError(`${DEV_PORT_ENV} must be between 19000 and 20999`)
  }
  return {
    mode: 'development',
    hermesHome: home,
    hermesBinary: absoluteEnvPath(env, DEV_BINARY_ENV),
    host: '127.0.0.1',
    preferredPort: Number(rawPort),
    portRange: 80,
    electronUserData: path.join(root, 'electron-user-data'),
    isolated: true
  }
}

function productionConfig(env) {
  const home = absoluteEnvPath(env, PROD_HOME_ENV, defaultLiveHome(env))
  if (isTestPath(home, env)) {
    throw new RuntimeModeError('Production refuses a temporary Hermes E2E home')
  }
  const binary = String(env[DEV_BINARY_ENV] || '').trim()
  if (binary && isTestPath(binary, env)) {
    throw new RuntimeModeError('Production refuses a temporary Hermes E2E binary')
  }
  return {
    mode: 'live',
    hermesHome: home,
    hermesBinary: binary ? absoluteEnvPath(env, DEV_BINARY_ENV) : null,
    host: '127.0.0.1',
    preferredPort: PROD_PORT,
    portRange: 80,
    electronUserData: null,
    isolated: false
  }
}

function configFromQa(qa) {
  return {
    mode: 'qa-isolated',
    hermesHome: qa.hermesHome,
    hermesBinary: null,
    host: qa.host,
    preferredPort: qa.port,
    portRange: 1,
    electronUserData: path.join(qa.hermesHome, 'electron-user-data'),
    isolated: true
  }
}

function configFromQaVerdict(qa, env) {
  if (qa.enabled) return configFromQa(qa)
  if (env[DEV_SENTINEL_ENV] === DEV_SENTINEL_VALUE) return devConfig(env)
  return productionConfig(env)
}

// Pure resolver: re-validates the QA override on every call. Test-facing only —
// production must go through getRuntimeMode, because validateIsolatedHome
// requires an EMPTY home and the app legitimately writes into it right after the
// first successful resolution (electron-user-data, Hermes state). A pure re-read
// would then throw mid-startup.
function resolveRuntimeMode(env = process.env) {
  return configFromQaVerdict(resolveQaRuntimeOverride(env), env)
}

// Production entry point: the QA verdict — the only filesystem-state-dependent
// part of runtime selection — comes from the process-wide memo in qa-runtime.cjs,
// so the emptiness check runs exactly once, before the app populates the home.
// Fail-closed is preserved: a REQUESTED-but-invalid override caches its error and
// getQaRuntimeOverride rethrows it on every subsequent call. Dev/prod selection
// stays a pure read of product-owned variables.
function getRuntimeMode(env = process.env) {
  return configFromQaVerdict(getQaRuntimeOverride(env), env)
}

function resolveHermesBinary(config = getRuntimeMode(), env = process.env) {
  // An explicit product-owned binary is authoritative, including when missing.
  // This supports a truthful no-runtime state and never silently falls back to
  // PATH or a different installation after an operator chose one exact binary.
  if (config.hermesBinary) {
    return fs.existsSync(config.hermesBinary) ? config.hermesBinary : null
  }
  const candidates = [
    process.platform === 'win32'
      ? path.join(defaultLiveHome(env), 'hermes-agent', 'venv', 'Scripts', 'hermes.exe')
      : path.join(defaultLiveHome(env), 'hermes-agent', 'venv', 'bin', 'hermes'),
    process.platform === 'win32'
      ? path.join(config.hermesHome, 'hermes-agent', 'venv', 'Scripts', 'hermes.exe')
      : path.join(config.hermesHome, 'hermes-agent', 'venv', 'bin', 'hermes'),
    process.platform === 'win32'
      ? path.join(config.hermesHome, 'bin', 'hermes.exe')
      : path.join(os.homedir(), '.local', 'bin', 'hermes')
  ].filter(Boolean)
  return candidates.find(candidate => fs.existsSync(candidate)) || null
}

function __resetRuntimeModeCache() {
  // Test-only: drop the memoized QA verdict so a suite can re-resolve under a
  // mutated environment. Dev/prod selection holds no cache of its own.
  __resetQaRuntimeOverrideCache()
}

module.exports = {
  DEV_SENTINEL_ENV,
  DEV_SENTINEL_VALUE,
  DEV_HOME_ENV,
  DEV_BINARY_ENV,
  DEV_PORT_ENV,
  PROD_HOME_ENV,
  PROD_PORT,
  DEV_PORT,
  RuntimeModeError,
  defaultLiveHome,
  defaultDevRoot,
  isTestPath,
  resolveRuntimeMode,
  getRuntimeMode,
  resolveHermesBinary,
  __resetRuntimeModeCache
}
