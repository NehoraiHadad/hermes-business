const fs = require('node:fs')
const path = require('node:path')
const { hermesHome } = require('./paths.cjs')
const { resolveRoots, denyAllSafeRoot } = require('./sandbox-roots.cjs')
const { safeWrite } = require('./atomic-write.cjs')

// Durable, local source of truth for the optional Business Partner mode and the
// Hermes-native sandbox selection. This file is intentionally the ONLY place the
// desktop shell persists its own preferences; the effective runtime behaviour is
// always applied to the single Hermes `default` profile from here. Check-in
// scheduling is NOT stored here beyond intent — the authoritative schedule lives in
// the official Hermes cron store, reconciled by partner-checkins.cjs.

const MODES = new Set(['normal', 'partner'])
const SANDBOX = new Set(['off', 'guard', 'docker'])
const ACCESS = new Set(['ro', 'rw'])
// Cadence presets a check-in may run at. Values map to real cron expressions in
// partner-checkins.cjs; the shell never invents a scheduler of its own.
const CADENCES = new Set(['daily', 'weekdays', 'weekly'])
const DEFAULT_CADENCE = 'weekly'

const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  mode: 'normal',
  sandbox: 'guard',
  network: false,
  checkins: false,
  checkinCadence: DEFAULT_CADENCE,
  roots: [],
  // Durable, versioned backup of EXACTLY the Hermes config fields this feature
  // owns (partner-config.cjs OWNED_FIELDS), captured once on the normal->partner
  // transition so disabling restores each field to its captured value — or, for a
  // field that was absent before partner mode, a value-equivalent stock default
  // (Hermes deep-merge cannot delete a key). Null in normal mode.
  configBackup: null
})

function settingsPath() {
  return path.join(hermesHome(), 'business', 'partner-settings.json')
}

function normalizeRoot(candidate) {
  const rootPath = String((candidate && candidate.path) || '').trim()
  if (!rootPath) return null
  const access = ACCESS.has(candidate.access) ? candidate.access : 'ro'
  return { path: rootPath, access }
}

function normalizeSettings(candidate = {}) {
  const roots = Array.isArray(candidate.roots) ? candidate.roots.map(normalizeRoot).filter(Boolean) : []
  // Dedupe by path, last write wins on access.
  const byPath = new Map()
  for (const root of roots) byPath.set(root.path, root)
  return {
    version: 1,
    mode: MODES.has(candidate.mode) ? candidate.mode : 'normal',
    sandbox: SANDBOX.has(candidate.sandbox) ? candidate.sandbox : 'guard',
    network: candidate.network === true,
    checkins: candidate.checkins === true,
    checkinCadence: CADENCES.has(candidate.checkinCadence) ? candidate.checkinCadence : DEFAULT_CADENCE,
    roots: [...byPath.values()],
    configBackup:
      candidate.configBackup && typeof candidate.configBackup === 'object' ? candidate.configBackup : null
  }
}

function readSettings() {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function writeSettings(candidate) {
  const settings = normalizeSettings(candidate)
  safeWrite(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`)
  return settings
}

// The write-safe root is the ONLY env the managed runtime injects for the
// sandbox. HERMES_WRITE_SAFE_ROOT gates write_file/patch/delete/move only — it
// never restricts reads or terminal execution. It is meaningful only in the
// local 'guard' tier; 'off' injects nothing and 'docker' governs writes through
// bind-mount permissions instead. Multiple valid writable roots are joined with
// the platform path delimiter.
//
// Fail closed. Hermes (agent/file_safety.get_safe_write_roots) leaves writes
// UNRESTRICTED when this env is absent/blank, so the guard tier must NEVER emit
// null while it is the active boundary. In partner+guard, ANY configuration that
// yields zero VALID writable roots — none designated, read-only-only, or every
// designated writable root invalid — injects a deterministic deny-all sentinel
// whose parent is the persisted partner-settings.json regular file, so Hermes'
// file tools cannot create any write under it (see sandbox-roots.denyAllSafeRoot).
// Hermes then denies every file-tool write until the owner picks a real writable
// folder, instead of failing open. Only outside the
// partner+guard tier (normal mode, 'off', or 'docker') is null correct — there the
// write-safe root is simply not this feature's boundary.
function writeRootEnv(settings = readSettings()) {
  if (settings.mode !== 'partner' || settings.sandbox !== 'guard') return null
  const resolved = resolveRoots(settings)
  if (resolved.writable.length === 0) return denyAllSafeRoot()
  return resolved.writable.join(path.delimiter)
}

module.exports = {
  DEFAULT_SETTINGS,
  MODES,
  SANDBOX,
  ACCESS,
  CADENCES,
  DEFAULT_CADENCE,
  settingsPath,
  normalizeSettings,
  readSettings,
  writeSettings,
  writeRootEnv
}
