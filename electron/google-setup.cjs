const { shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { hermesHome, findHermes } = require('./paths.cjs')
const { hermesApi } = require('./runtime.cjs')
const { runCaptured, parseJsonOutput } = require('./process-util.cjs')
const { rememberLog } = require('./logs.cjs')

// Drives the official google-workspace Skill's setup.py for OAuth, and ensures
// the Hermes gateway is installed and running in the background. This module
// never stores secrets; it only shells out to the Skill's own scripts.

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

async function ensureGatewayBackground(command = findHermes()) {
  if (!command) return { ok: false, installed: false }
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
  if (running && startsOnLogin) {
    return { ok: true, installed: true, running: true }
  }

  await runCaptured(command, ['gateway', 'install', '--start-now', '--start-on-login'], 180_000)
  return { ok: true, installed: true, running: true }
}

async function startGoogleSetup(clientSecretPath, services = 'all') {
  const { python, script } = await googleSetupPaths()
  if (!script || !python || !fs.existsSync(python)) {
    throw new Error('Google Workspace skill is not available in this Hermes install')
  }
  await runCaptured(python, [script, '--client-secret', clientSecretPath])
  const result = await runCaptured(python, [script, '--auth-url', '--services', services, '--format', 'json'])
  const payload = parseJsonOutput(result.stdout)
  const authUrl = payload?.auth_url
  if (!authUrl) throw new Error('Hermes did not return a Google authorization URL')
  await shell.openExternal(authUrl)
  return { ok: true, authUrl }
}

async function finishGoogleSetup(code) {
  const { python, script } = await googleSetupPaths()
  if (!script || !python || !fs.existsSync(python)) {
    throw new Error('Google Workspace skill is not available in this Hermes install')
  }
  const result = await runCaptured(python, [script, '--auth-code', code, '--format', 'json'])
  const payload = parseJsonOutput(result.stdout) || {}
  const check = await runCaptured(python, [script, '--check'])
  const authenticated = /AUTHENTICATED/i.test(check.stdout)
  if (!authenticated) throw new Error('Google authorization was not completed')
  return { ok: true, ...payload }
}

async function getGoogleStatus() {
  const { python, script } = await googleSetupPaths()
  if (!script || !python || !fs.existsSync(python)) {
    return { available: false, authenticated: false }
  }
  try {
    const result = await runCaptured(python, [script, '--check'], 45_000)
    return {
      available: true,
      authenticated: /^AUTHENTICATED(?:\s|:|$)/im.test(result.stdout)
    }
  } catch {
    // The official setup script exits non-zero for NOT_AUTHENTICATED.
    return { available: true, authenticated: false }
  }
}

module.exports = { startGoogleSetup, finishGoogleSetup, getGoogleStatus, ensureGatewayBackground }
