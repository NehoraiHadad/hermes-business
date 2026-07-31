const { readSettings, writeSettings, normalizeSettings, writeRootEnv } = require('./partner-settings.cjs')
const { getConfig, dockerReadiness } = require('./hermes-config.cjs')
const { enablePersonality, disablePersonality } = require('./partner-mode.cjs')
const { computeSandboxPlan, applySandbox } = require('./sandbox-config.cjs')
const { installPartnerSkill } = require('./partner-skill-install.cjs')
const { PERSONALITY_NAME } = require('./partner-personality.cjs')

// Single orchestrator the renderer drives through IPC. It coordinates the durable
// local settings, the native personality switch, the packaged Skill, and the
// sandbox tier — all over the ONE existing Hermes `default` profile/runtime. Read
// paths are defensive so the Support screen renders even when the runtime is down.

async function getPartnerState(options = {}) {
  const api = options.api
  const settings = readSettings()
  let docker = { ready: false, present: false, status: 'unknown' }
  let backend = null
  let personalityActive = false
  let liveError = null

  try {
    docker = await dockerReadiness(api)
  } catch (error) {
    liveError = String(error.message || error)
  }
  try {
    const config = await getConfig(api)
    backend = (config && config.terminal && config.terminal.backend) || null
    personalityActive = Boolean(config && config.display && config.display.personality === PERSONALITY_NAME)
  } catch (error) {
    liveError = liveError || String(error.message || error)
  }

  const dockerStatus = settings.sandbox === 'docker' ? docker : { ready: false, status: 'not-requested' }
  const plan = computeSandboxPlan(settings, dockerStatus)
  return {
    mode: settings.mode,
    sandbox: settings.sandbox,
    network: settings.network,
    checkins: settings.checkins,
    roots: settings.roots,
    plan,
    docker,
    backend,
    personalityActive,
    writeRoot: writeRootEnv(settings),
    liveError
  }
}

// Applies a settings patch: flips the personality (idempotent capture/restore),
// installs the Skill, applies the sandbox, then — only after every live Hermes
// stage succeeded — persists settings and restarts the managed runtime (the
// latter only when the injected write-root env actually changed).
//
// Fail closed: the live config stages run BEFORE the durable write. If a later
// stage throws after the personality was flipped on, the personality is rolled
// back to its captured previous value and settings are NOT persisted, so the
// operation can never leave a half-applied partner state on disk or in config.
async function applyPartnerMode(patch = {}, options = {}) {
  const api = options.api
  const current = readSettings()
  const next = normalizeSettings({ ...current, ...patch, personalityBackup: current.personalityBackup })

  let personalityBackup = current.personalityBackup
  let skill = null
  let applied = null

  if (next.mode === 'partner') {
    const enabled = await enablePersonality(current.personalityBackup, api)
    personalityBackup = enabled.backup
    try {
      skill = installPartnerSkill()
      applied = await applySandbox({ ...next, personalityBackup }, { api })
    } catch (error) {
      // Restore the exact captured previous personality so config is not left
      // with the partner persona on but the sandbox tier unpinned. Best-effort:
      // the original error is always what we surface to the caller.
      try {
        await disablePersonality(personalityBackup, api)
      } catch {
        /* keep the primary failure as the thrown error */
      }
      throw error
    }
  } else {
    if (current.mode === 'partner') {
      await disablePersonality(current.personalityBackup, api)
      personalityBackup = null
    }
    applied = await applySandbox({ ...next, personalityBackup }, { api })
  }

  // Durable write happens last: only a fully-applied live config is persisted.
  const persisted = writeSettings({ ...next, personalityBackup })

  const restart = options.restart || (() => require('./runtime.cjs').restartHermes())
  const restarted = writeRootEnv(current) !== writeRootEnv(persisted)
  if (restarted) await restart()

  return { settings: persisted, sandbox: applied, skill, restarted }
}

module.exports = { getPartnerState, applyPartnerMode }
