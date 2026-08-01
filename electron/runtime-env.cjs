const { writeRootEnv } = require('./partner-settings.cjs')
const { childEnvForOverride } = require('./qa-runtime.cjs')

// Assemble the child gateway's environment. Production adds only the session
// token and the desktop flag (plus the write-guard safe root when that tier is
// active). Under the QA-isolated contract it also overlays the throwaway
// HERMES_HOME + hard-disabled channels/telemetry from childEnvForOverride.
function buildChildEnv({ sessionToken, override }) {
  const env = {
    ...process.env,
    HERMES_DASHBOARD_SESSION_TOKEN: sessionToken,
    HERMES_DESKTOP: '1',
    ...(override.enabled ? childEnvForOverride(override) : {})
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
