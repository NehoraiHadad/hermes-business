const { randomBytes } = require('node:crypto')
const { HERMES_COMPAT_RANGE } = require('./hermes-compat.cjs')
const { wsUrlWithToken } = require('./hermes-auth.cjs')

// Single owner of the managed runtime's mutable state: the private session token,
// the dynamically chosen loopback port, the child process handle and the
// renderer-facing runtimeState snapshot. Extracted from runtime.cjs so the launch,
// proxy and facade concerns share ONE source of truth (and one token instance)
// without a circular import.

const PREFERRED_PORT = 9119
const SESSION_TOKEN = randomBytes(32).toString('base64url')

let runtimePort = PREFERRED_PORT
let hermesProcess = null

const baseUrl = () => `http://127.0.0.1:${runtimePort}`
// Loopback WS auth is the `?token=` query param ONLY — the single-use `?ticket=`
// path is gated-mode-only and never checked on a loopback bind. See hermes-auth.
const wsUrl = () => wsUrlWithToken(`ws://127.0.0.1:${runtimePort}/api/ws`, SESSION_TOKEN)

let runtimeState = {
  installed: false,
  running: false,
  starting: false,
  mode: 'live',
  isolated: false,
  version: null,
  compatible: true,
  compatRange: HERMES_COMPAT_RANGE,
  error: null,
  // Effective HERMES_HOME. This is shown in the local support surface so a
  // developer can tell live, development and QA sessions apart immediately.
  hermesHome: null,
  // Executable QA proof surface. Populated ONLY under the qa-isolated contract:
  // { namespaceApplied, attestation:{ nonce, fingerprintPrefix, headShort,
  // artifactKind } }. Lets the harness prove — from the live binary — that the QA
  // Electron namespace fix ran before the single-instance lock and that this is
  // the freshly attested win-unpacked artifact (nonce match). Null in production.
  qa: null,
  wsUrl: wsUrl()
}

const getRuntimeState = () => runtimeState
/** Merge a partial into the runtime state and return the new snapshot. */
const patchRuntimeState = partial => {
  // Every runtime failure flows through this single owner, so recording here
  // gives the diagnostics error journal full coverage with no per-site wiring.
  if (partial && partial.error) {
    require('./error-journal.cjs').recordAppError('runtime', partial.error)
  }
  runtimeState = { ...runtimeState, ...partial }
  return runtimeState
}
const getSessionToken = () => SESSION_TOKEN
const getRuntimePort = () => runtimePort
const setRuntimePort = port => {
  runtimePort = port
}
const getHermesProcess = () => hermesProcess
const setHermesProcess = proc => {
  hermesProcess = proc
}

module.exports = {
  PREFERRED_PORT,
  SESSION_TOKEN,
  baseUrl,
  wsUrl,
  getRuntimeState,
  patchRuntimeState,
  getSessionToken,
  getRuntimePort,
  setRuntimePort,
  getHermesProcess,
  setHermesProcess
}
