const { shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { hermesHome, findHermes } = require('./paths.cjs')
const { hermesApi } = require('./runtime.cjs')
const { runCaptured } = require('./process-util.cjs')
const { rememberLog } = require('./logs.cjs')
const {
  GOOGLE_SERVICES,
  parseHelp,
  parseAuthUrl,
  parseCheckStatus,
  safeSetupError
} = require('./google-contract.cjs')

// Drives the official google-workspace Skill's setup.py (Hermes v0.19.1) for
// OAuth, and ensures the Hermes gateway is installed and running in the
// background. This module never stores secrets; it only shells out to the
// Skill's own scripts. All contract knowledge lives in google-contract.cjs so
// it can be unit-tested without electron. v0.19.1 has FIXED scopes: it exposes
// no --services / --format flags, so we never pass them or parse JSON.

async function googleSetupPaths() {
  const root = hermesHome()
  const hermesCommand = findHermes()
  const pythonCandidates = process.platform === 'win32'
    ? [
        hermesCommand ? path.join(path.dirname(hermesCommand), 'python.exe') : '',
        path.join(root, 'hermes-agent', 'venv', 'Scripts', 'python.exe')
      ]
    : [
        hermesCommand ? path.join(path.dirname(hermesCommand), 'python') : '',
        path.join(root, 'hermes-agent', 'venv', 'bin', 'python')
      ]
  let discoveredSkillRoot = ''
  try {
    const skill = await hermesApi('/api/skills/content?name=google-workspace&profile=default')
    if (typeof skill?.path === 'string') discoveredSkillRoot = path.dirname(skill.path)
  } catch {
    // Older compatible Hermes builds may not expose Skill content over HTTP.
  }
  const candidates = [
    discoveredSkillRoot ? path.join(discoveredSkillRoot, 'scripts', 'setup.py') : '',
    path.join(root, 'skills', 'productivity', 'google-workspace', 'scripts', 'setup.py'),
    path.join(root, 'hermes-agent', 'skills', 'productivity', 'google-workspace', 'scripts', 'setup.py')
  ]
  return {
    python: pythonCandidates.find(candidate => candidate && fs.existsSync(candidate)),
    script: candidates.find(candidate => candidate && fs.existsSync(candidate))
  }
}

// All setup steps share one resolved HERMES_HOME so the pending-auth session,
// the client secret, and the resulting token all land in the same profile.
function setupEnv() {
  return { HERMES_HOME: hermesHome() }
}

function requireScript(python, script) {
  if (!script || !python || !fs.existsSync(python)) {
    throw new Error('Google Workspace skill is not available in this Hermes install')
  }
}

// Read `setup.py --help` once per flow to learn which flags this build supports.
async function readContract(python, script) {
  try {
    const help = await runCaptured(python, [script, '--help'], 20_000, setupEnv())
    return parseHelp(`${help.stdout}\n${help.stderr}`)
  } catch (error) {
    rememberLog(`Could not read google setup --help: ${error.message || error}`)
    return parseHelp('') // conservative: treat every optional flag as absent
  }
}

async function ensureGatewayBackground(command = findHermes()) {
  if (!command) return { ok: false, installed: false, startedFresh: false }
  let probe
  try {
    probe = await runCaptured(command, ['gateway', 'status'], 45_000)
  } catch (error) {
    rememberLog(`Gateway status check failed: ${error.message || error}`)
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
  await runCaptured(command, ['gateway', 'install', '--start-now', '--start-on-login'], 180_000)
  return { ok: true, installed: true, running: true, startedFresh: true }
}

async function startGoogleSetup(clientSecretPath) {
  const { python, script } = await googleSetupPaths()
  requireScript(python, script)
  const contract = await readContract(python, script)
  await runCaptured(python, [script, '--client-secret', clientSecretPath], 60_000, setupEnv())
  let result
  try {
    // --auth-url prints the raw authorization URL as its only output line.
    result = await runCaptured(python, [script, '--auth-url'], 60_000, setupEnv())
  } catch (error) {
    throw new Error(safeSetupError(error, 'Hermes could not produce a Google authorization URL'))
  }
  const authUrl = parseAuthUrl(result.stdout)
  if (!authUrl) throw new Error('Hermes did not return a Google authorization URL')
  await shell.openExternal(authUrl)
  return {
    ok: true,
    authUrl,
    services: GOOGLE_SERVICES,
    serviceSelectionAvailable: contract.supportsServices
  }
}

async function finishGoogleSetup(callbackUrl) {
  const { python, script } = await googleSetupPaths()
  requireScript(python, script)
  try {
    // --auth-code accepts either a raw code or the full localhost callback URL;
    // we pass the callback URL verbatim so PKCE state is validated by the script.
    await runCaptured(python, [script, '--auth-code', callbackUrl], 90_000, setupEnv())
  } catch (error) {
    throw new Error(safeSetupError(error, 'Google authorization could not be completed'))
  }
  const check = await runCaptured(python, [script, '--check'], 45_000, setupEnv()).catch(() => ({ stdout: '' }))
  const status = parseCheckStatus(check.stdout)
  if (!status.authenticated) throw new Error('Google authorization was not completed')
  return { ok: true, partial: status.partial, services: GOOGLE_SERVICES }
}

async function getGoogleStatus() {
  const { python, script } = await googleSetupPaths()
  if (!script || !python || !fs.existsSync(python)) {
    return { available: false, authenticated: false, serviceSelectionAvailable: false, services: GOOGLE_SERVICES }
  }
  try {
    const result = await runCaptured(python, [script, '--check'], 45_000, setupEnv())
    const status = parseCheckStatus(result.stdout)
    return {
      available: true,
      authenticated: status.authenticated,
      partial: status.partial,
      services: GOOGLE_SERVICES,
      serviceSelectionAvailable: false
    }
  } catch {
    // The official setup script exits non-zero for NOT_AUTHENTICATED.
    return { available: true, authenticated: false, services: GOOGLE_SERVICES, serviceSelectionAvailable: false }
  }
}

module.exports = { startGoogleSetup, finishGoogleSetup, getGoogleStatus, ensureGatewayBackground }
