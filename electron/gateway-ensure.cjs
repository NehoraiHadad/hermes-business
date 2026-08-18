const { findHermes } = require('./paths.cjs')
const { getQaRuntimeOverride } = require('./qa-runtime.cjs')
const { runCaptured } = require('./process-util.cjs')
const { rememberLog } = require('./logs.cjs')

// Background gateway registration — extracted from google-setup.cjs so the QA
// suppression below is unit-testable (google-setup requires electron's `shell`,
// which does not resolve under vitest; this module is electron-free and
// re-exported from there for its existing consumers).
async function ensureGatewayBackground(
  command = findHermes(),
  { qaOverride = getQaRuntimeOverride, run = runCaptured, log = rememberLog } = {}
) {
  // `gateway install` registers USER-LEVEL auto-start (Startup login item /
  // Scheduled Task) pointing at whatever HERMES_HOME this process resolves.
  // Under an ARMED QA runtime override that home is a throwaway QA dir, so the
  // registration would silently repoint the LIVE install's logon recovery at a
  // directory that is deleted when the run ends (observed live 2026-08-16 and
  // three times on 2026-08-17). The isolated runtime a QA run needs is started
  // by startHermes against the QA home/port; user-level registration is never
  // its concern. A requested-but-invalid override throws out of
  // getQaRuntimeOverride (fail-closed, memoized) — it can never fall through
  // to the production install path.
  const override = qaOverride()
  if (override && override.enabled) {
    return { ok: true, installed: false, running: false, startedFresh: false, skipped: 'qa-isolated-runtime' }
  }
  if (!command) return { ok: false, installed: false, startedFresh: false }
  let probe
  try {
    probe = await run(command, ['gateway', 'status'], 45_000)
  } catch (error) {
    log(`Gateway status check failed: ${error.message || error}`)
    probe = { stdout: '', stderr: '' }
  }
  const output = `${probe.stdout || ''}\n${probe.stderr || ''}`
  const running = /gateway (?:process )?running|gateway is running/i.test(output)
  const startsOnLogin = /login item installed|scheduled task (?:installed|registered)/i.test(output)
  // Already up and auto-starting → do NOT restart it; report startedFresh: false so the guard
  // activation knows it may still be running the OLD plugin code (→ may need an official restart).
  if (running && startsOnLogin) {
    return { ok: true, installed: true, running: true, startedFresh: false }
  }

  // We are (re)starting the gateway here — the process launched below loads the just-installed
  // plugin, so activation can skip a redundant restart but must still require a fresh heartbeat.
  await run(command, ['gateway', 'install', '--start-now', '--start-on-login'], 180_000)
  return { ok: true, installed: true, running: true, startedFresh: true }
}

module.exports = { ensureGatewayBackground }
