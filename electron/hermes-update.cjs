const { rememberLog } = require('./logs.cjs')
const { findHermes, getHermesVersion } = require('./paths.cjs')
const { runCaptured } = require('./process-util.cjs')
const { stopHermes, startHermes, hermesApi } = require('./runtime.cjs')
const { ensureGatewayBackground } = require('./google-setup.cjs')
const {
  assertUpdateTargetSupported,
  assertUpdateMethodSupported,
  assertRunningVersionSupported
} = require('./hermes-compat.cjs')
const { assertGatewayDeepHealthy } = require('./hermes-health.cjs')
const { officialGatewayState } = require('./gateway-status.cjs')
const { assertReleaseReachable } = require('./hermes-update-preflight.cjs')
const { createPreUpdateBackup } = require('./hermes-backup.cjs')
const { captureRollbackAnchor, rollbackAfterFailedUpdate } = require('./hermes-rollback.cjs')
const journal = require('./hermes-update-journal.cjs')
const { runOfficialUpdate } = require('./hermes-update-flow.cjs')

// Thin wiring layer: bind the real (Electron/process/git/disk) collaborators to
// the pure orchestration in hermes-update-flow.cjs, and serialize concurrent
// runs. A single in-flight update flag lives here (renderer-facing), never in the
// DI-tested flow module.

let updateInProgress = false

function defaultDeps() {
  return {
    findHermes,
    getHermesVersion,
    runCaptured,
    rememberLog,
    stopHermes,
    startHermes,
    hermesApi,
    ensureGatewayBackground,
    assertGatewayDeepHealthy: command => assertGatewayDeepHealthy(command),
    assertUpdateMethodSupported,
    assertReleaseReachable: command => assertReleaseReachable(command),
    assertUpdateTargetSupported,
    assertRunningVersionSupported,
    createPreUpdateBackup,
    captureRollbackAnchor,
    rollbackAfterFailedUpdate,
    // The repo's ONE authoritative gateway-liveness reader (official
    // `hermes gateway status`, never the heartbeat). The flow uses it to prove the
    // old gateway is gone after a post-rollback stop.
    gatewayState: officialGatewayState,
    journal
  }
}

async function applyOfficialHermesUpdate() {
  if (updateInProgress) throw new Error('עדכון Hermes כבר מתבצע')
  updateInProgress = true
  try {
    return await runOfficialUpdate(defaultDeps())
  } finally {
    updateInProgress = false
  }
}

module.exports = { applyOfficialHermesUpdate }
