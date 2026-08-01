const { spawnSync } = require('node:child_process')
const { findHermes, hermesHome } = require('./paths.cjs')

// Authoritative, OFFICIAL snapshot of whether a Hermes gateway PROCESS is already running,
// read from `hermes gateway status` (v0.19.1) — NOT from the guard heartbeat.
//
// Why not the heartbeat: an OLD gateway launched before the guard published heartbeats writes
// no heartbeat file, so a heartbeat probe would report "no gateway" and a plugin update would
// wrongly SKIP the mandatory restart, leaving the old code running unsupervised. The official
// status command reports OS-level process liveness directly, independent of the guard plugin.
//
// Returns { state } where state is:
//   'running'  — a gateway process is definitively up (matched a positive PID line)
//   'stopped'  — the command positively reported no gateway process
//   'unknown'  — command missing / spawn error / non-zero-and-unparseable output (FAIL CLOSED:
//                the caller must NOT assume any old code was superseded).

// Positive process-liveness lines the CLI prints across service + manual + ensure paths, e.g.
// "✓ Gateway process running (PID: 1234)", "✓ Gateway is running (PID: 1234)",
// "✓ Gateway already running (PID: 1234)". All carry "(PID:" — anchor on that to avoid
// matching the SERVICE-level "✗ Gateway service not installed" while a process runs manually.
const RUNNING_RE = /gateway[^\n]*running \(pid/i
const STOPPED_RE = /no gateway process detected|gateway is not running/i

function officialGatewayState(options = {}) {
  const command = options.command !== undefined ? options.command : findHermes()
  if (!command) return { state: 'unknown', reason: 'hermes-not-found' }
  const runner = options.runner || spawnSync
  let result
  try {
    result = runner(command, ['gateway', 'status'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: options.timeoutMs || 45_000,
      env: { ...process.env, HERMES_HOME: options.home || hermesHome() }
    })
  } catch (error) {
    return { state: 'unknown', reason: `spawn-failed: ${error.message || error}` }
  }
  if (!result || result.error) {
    return { state: 'unknown', reason: (result && result.error && result.error.message) || 'no-result' }
  }
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  // A non-zero exit alone is NOT "stopped" — only a positive textual match decides. Anything
  // ambiguous stays 'unknown' so the caller fails closed rather than skipping a restart.
  if (RUNNING_RE.test(output)) return { state: 'running', output }
  if (STOPPED_RE.test(output)) return { state: 'stopped', output }
  return { state: 'unknown', reason: 'unparseable-status', output }
}

module.exports = { officialGatewayState, RUNNING_RE, STOPPED_RE }
