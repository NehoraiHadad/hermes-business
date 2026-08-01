const { readSettings, writeSettings, normalizeSettings, writeRootEnv } = require('./partner-settings.cjs')
const { persistedRoots } = require('./sandbox-roots.cjs')
const { getConfig, dockerReadiness } = require('./hermes-config.cjs')
const { applyPersona } = require('./partner-mode.cjs')
const { computeSandboxPlan, planSandbox, applyResolvedPlan } = require('./sandbox-config.cjs')
const { snapshotOwned, restoreOwned, restoreOwnedTransactional } = require('./partner-config.cjs')
const { installPartnerSkill } = require('./partner-skill-install.cjs')
const { PERSONALITY_NAME } = require('./partner-personality.cjs')
const { createCronClient } = require('./partner-cron.cjs')
const { reconcileCheckins, readCheckinStatus } = require('./partner-checkins.cjs')

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
  const cron = options.cron || createCronClient(api)
  const checkin = await readCheckinStatus(cron)
  // Honest live vs. intent divergence (e.g. an opt-out whose pause did not land, or
  // a not-yet-reconciled opt-in). Only asserted when the store was actually read —
  // a null read (runtime down) is reported via liveError, not a false mismatch.
  const intendScheduled = settings.mode === 'partner' && settings.checkins === true
  // Mismatch when live ≠ intent OR when duplicate ACTIVE owned jobs exist (two check-ins
  // would fire) — an aggregated inconsistency the canonical job alone would hide.
  const checkinMismatch =
    checkin !== null && (Boolean(checkin.scheduled) !== intendScheduled || checkin.mismatch === true)
  return {
    mode: settings.mode,
    sandbox: settings.sandbox,
    network: settings.network,
    checkins: settings.checkins,
    checkinCadence: settings.checkinCadence,
    // Canonical view (same resolver Docker/guard use): valid roots → real target,
    // invalid → raw selection (reason in plan.invalidRoots), never effective.
    roots: persistedRoots(settings),
    plan,
    docker,
    backend,
    personalityActive,
    checkin,
    checkinMismatch,
    writeRoot: writeRootEnv(settings),
    liveError
  }
}

// Applies a settings patch as a transaction over the live Hermes config, then
// persists intent and reconciles the check-in.
// Enabling (mode partner): fail closed on invalid roots BEFORE any write; snapshot
// the owned config ONCE up front; apply persona + sandbox + Skill; on ANY stage
// failure restore the snapshot (rolling back every already-applied stage) and
// persist nothing. Disabling: transactionally restore the durable pre-partner
// backup (present fields to their captured value, previously-absent fields to a
// value-equivalent stock default), rolling back on any failure and persisting only
// on complete success. Touches only owned fields.
async function applyPartnerMode(patch = {}, options = {}) {
  const api = options.api
  const current = readSettings()
  const next = normalizeSettings({ ...current, ...patch, configBackup: current.configBackup })

  let configBackup = current.configBackup
  let skill = null
  let applied = null

  if (next.mode === 'partner') {
    const plan = await planSandbox(next, { api, dockerReadiness: options.dockerReadiness })
    const preOp = await snapshotOwned(api)
    // Capture the durable pre-partner backup only on the normal->partner transition
    // (or if a prior one is missing); an intra-partner change keeps the ORIGINAL
    // backup so disabling still returns to true stock.
    if (current.mode !== 'partner' || !configBackup) configBackup = preOp
    try {
      await applyPersona(api)
      applied = await applyResolvedPlan(plan, api)
      skill = installPartnerSkill()
    } catch (error) {
      try {
        await restoreOwned(preOp, api)
      } catch {
        /* keep the primary failure as the thrown error */
      }
      throw error
    }
  } else {
    if (current.mode === 'partner') {
      // Restore EVERY owned field (personality, approvals, delegation, terminal
      // backend, docker binds) toward its captured pre-partner state, so nothing
      // partner-mode set lingers. Transactional: a failure between the config PUT and
      // the backend pin rolls back and rethrows, so settings below stay 'partner'.
      await restoreOwnedTransactional(current.configBackup, api)
    }
    applied = computeSandboxPlan(next, { ready: false, status: 'not-requested' })
    configBackup = null
  }

  // Durable write happens last: only a fully-applied live config is persisted, with
  // CANONICAL roots so startup / writeRootEnv / UI / Docker never re-derive a link.
  const persisted = writeSettings({ ...next, roots: persistedRoots(next), configBackup })

  const restart = options.restart || (() => require('./runtime.cjs').restartHermes())
  const restarted = writeRootEnv(current) !== writeRootEnv(persisted)
  if (restarted) await restart()

  // Reconcile the check-in against the ONE official cron store AFTER intent is
  // durably persisted. Idempotent and retried on every startup. A failure is
  // reported honestly via checkin.error and NEVER masqueraded as success — the
  // renderer surfaces it and getPartnerState.checkinMismatch keeps showing it.
  const cron = options.cron || createCronClient(api)
  let checkin
  try {
    checkin = await reconcileCheckins(persisted, cron)
  } catch (error) {
    checkin = {
      desired: persisted.mode === 'partner' && persisted.checkins,
      error: String(error.message || error)
    }
  }

  return { settings: persisted, sandbox: applied, skill, restarted, checkin }
}

// Startup reconciliation: make the official cron store agree with persisted intent
// after a restart. Best-effort and non-fatal so the desktop always launches.
async function reconcilePartnerCheckinsOnStartup(options = {}) {
  const settings = readSettings()
  const cron = options.cron || createCronClient(options.api)
  return reconcileCheckins(settings, cron)
}

module.exports = { getPartnerState, applyPartnerMode, reconcilePartnerCheckinsOnStartup }
