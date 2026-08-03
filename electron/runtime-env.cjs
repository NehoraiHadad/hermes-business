const { writeRootEnv } = require('./partner-settings.cjs')
const { childEnvForOverride } = require('./qa-runtime.cjs')
const { getRuntimeMode } = require('./runtime-mode.cjs')

// Assemble the child gateway's environment. Production pins HERMES_HOME to the
// same resolved profile used by Electron-side setup/status checks; otherwise
// skill scripts launched by the agent fall back to ~/.hermes while the UI reads
// %LOCALAPPDATA%/hermes and a real Google connection appears missing. Under the
// QA-isolated contract the throwaway home overlay remains authoritative.
function buildChildEnv({ sessionToken, runtimeConfig = getRuntimeMode(), override }) {
  // `override` remains accepted for older tests/callers; the central runtime
  // contract is authoritative for the real app.
  const config = override
    ? {
        mode: override.enabled ? 'qa-isolated' : 'live',
        hermesHome: override.hermesHome || getRuntimeMode().hermesHome,
        isolated: Boolean(override.enabled)
      }
    : runtimeConfig
  const env = {
    ...process.env,
    HERMES_HOME: config.hermesHome,
    HERMES_DASHBOARD_SESSION_TOKEN: sessionToken,
    HERMES_DESKTOP: '1',
    ...(config.isolated ? childEnvForOverride(config) : {})
  }
  // The ONLY env the sandbox injects: the write-safe root for the local 'guard'
  // tier. It gates write_file/patch/delete/move (not reads/terminal). Absent for
  // the 'off' and 'docker' tiers, so a stale value never lingers across changes.
  const safeRoot = (() => {
    try {
      return writeRootEnv()
    } catch {
      return null
    }
  })()
  if (safeRoot) env.HERMES_WRITE_SAFE_ROOT = safeRoot
  return env
}

module.exports = { buildChildEnv }
