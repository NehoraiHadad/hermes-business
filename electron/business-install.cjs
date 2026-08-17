const fs = require('node:fs')
const path = require('node:path')
const { stageBusinessBootstrap } = require('./plugin-install.cjs')
const { runCaptured } = require('./process-util.cjs')
const { findHermes, hermesHome } = require('./paths.cjs')

// The ONE install door. A machine that already has a compatible Hermes and a
// machine with none both run the SAME staged bootstrap transaction, so both end
// up with the same skills (business-bootstrap, tachles-welcome and
// business-partner), the community tooling with its RENDERED community skills,
// the WhatsApp reply-policy plugin and the companion backend. Until this module
// existed the already-installed machine took a JS-only shortcut that copied the
// desktop plugin and nothing else, so the two doors produced different machines.
//
// bootstrap.ps1 owns the "is Hermes already here?" question itself: Find-Hermes
// short-circuits the engine download and Assert-CompatibleVersion preserves a
// compatible existing install. So this module deliberately does NOT branch on
// findHermes() — a second detection here can disagree with the script's (they
// search different candidate paths) and would split the doors apart again.

const BOOTSTRAP_TIMEOUT_MS = 45 * 60_000

function bootstrapArguments(payloadRoot, bootstrapVersion, home) {
  return [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', path.join(payloadRoot, 'bootstrap.ps1'),
    '-PayloadRoot', payloadRoot,
    '-BootstrapVersion', bootstrapVersion,
    '-HermesHome', home,
    // The companion IS this running app, and the caller owns when a window
    // appears, so the bootstrap must neither install nor launch one.
    '-SkipCompanionInstall',
    '-NoLaunch'
  ]
}

// Runs the bootstrap and reports whether Hermes is present afterwards. A failing
// transaction REJECTS (runCaptured rejects on a non-zero exit with the redacted
// child output) — the renderer's install flow already treats a rejection as the
// install error, so the failure surface is unchanged. The staged payload is
// removed on every exit path.
async function performInstall({
  bootstrapVersion,
  home = hermesHome(),
  stage = stageBusinessBootstrap,
  run = runCaptured,
  locate = findHermes
} = {}) {
  if (!bootstrapVersion) throw new Error('התקנת Hermes דורשת מספר גרסה')
  const payloadRoot = stage()
  try {
    await run('powershell.exe', bootstrapArguments(payloadRoot, bootstrapVersion, home), BOOTSTRAP_TIMEOUT_MS)
  } finally {
    fs.rmSync(payloadRoot, { recursive: true, force: true })
  }
  const installed = Boolean(locate())
  return { ok: installed, installed, code: installed ? 0 : 1 }
}

module.exports = { BOOTSTRAP_TIMEOUT_MS, bootstrapArguments, performInstall }
