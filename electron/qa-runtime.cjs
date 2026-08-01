const {
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
} = require('./qa-runtime-policy.cjs')

// Main-process-only runtime override for AUTOMATED QA of the packaged companion.
//
// Purpose: let a QA harness boot the *real installed Hermes code* against an
// ISOLATED, throwaway HERMES_HOME on an isolated loopback port, so the packaged
// UI/approval E2E can run without ever touching the live Hermes profile or its
// default gateway. Production (no QA env) is completely unaffected: the sentinel
// is absent, resolveQaRuntimeOverride returns { enabled: false }, and runtime.cjs
// takes its exact pre-existing one-live-home path.
//
// The fail-closed path/host/port policy lives in qa-runtime-policy.cjs; this
// module resolves the override, memoizes the verdict process-wide and derives the
// isolated child-process env overlay.

/**
 * Resolve the QA runtime override from the environment. Returns
 * { enabled: false } for the production (no-sentinel) path. When the sentinel is
 * present it validates strictly and returns
 * { enabled: true, hermesHome, host, port } or THROWS QaOverrideError.
 */
function resolveQaRuntimeOverride(env = process.env) {
  if (env[SENTINEL_ENV] !== SENTINEL_VALUE) return { enabled: false }
  const hermesHome = validateIsolatedHome(env)
  const host = validateHost(env)
  const port = validatePort(env)
  return { enabled: true, hermesHome, host, port }
}

/**
 * Child-process env overlay for the isolated runtime: point HERMES_HOME at the
 * throwaway dir and hard-disable every external channel + update/telemetry
 * callout so the isolated gateway can never reach the network or a live account.
 */
function childEnvForOverride(override) {
  return {
    HERMES_HOME: override.hermesHome,
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

// Process-wide memoized resolution. The environment is fixed for the lifetime of
// the main process, so we resolve once and every consumer (paths.hermesHome,
// runtime.startHermes) shares the same verdict. A REQUESTED-but-invalid override
// throws here on every call — fail-closed — so no home-derived write can ever
// silently fall back to the live profile once a QA run was asked for.
let cached
function getQaRuntimeOverride(env = process.env) {
  if (cached === undefined) {
    cached = { value: null, error: null }
    try {
      cached.value = resolveQaRuntimeOverride(env)
    } catch (error) {
      cached.error = error
    }
  }
  if (cached.error) throw cached.error
  return cached.value
}

// Test-only: drop the memoized verdict so a suite can re-resolve under a mutated
// environment. Never called in production.
function __resetQaRuntimeOverrideCache() {
  cached = undefined
}

module.exports = {
  resolveQaRuntimeOverride,
  getQaRuntimeOverride,
  __resetQaRuntimeOverrideCache,
  childEnvForOverride,
  QaOverrideError,
  SENTINEL_ENV,
  SENTINEL_VALUE,
  HOME_ENV,
  HOST_ENV,
  PORT_ENV,
  ALLOWED_HOST,
  PORT_MIN,
  PORT_MAX,
  DEFAULT_GATEWAY_PORT
}
