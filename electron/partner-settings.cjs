const fs = require('node:fs')
const path = require('node:path')
const { hermesHome } = require('./paths.cjs')

// Durable, local source of truth for the optional Business Partner mode and the
// Hermes-native sandbox selection. This file is intentionally the ONLY place the
// desktop shell persists its own preferences; the effective runtime behaviour is
// always applied to the single Hermes `default` profile from here.

const MODES = new Set(['normal', 'partner'])
const SANDBOX = new Set(['off', 'guard', 'docker'])
const ACCESS = new Set(['ro', 'rw'])

const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  mode: 'normal',
  sandbox: 'guard',
  network: false,
  checkins: false,
  roots: [],
  // Exact previous native personality config, captured once when partner mode is
  // first enabled so disabling restores it byte-for-byte (idempotent).
  personalityBackup: null
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
    roots: [...byPath.values()],
    personalityBackup:
      candidate.personalityBackup && typeof candidate.personalityBackup === 'object'
        ? candidate.personalityBackup
        : null
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
  const target = settingsPath()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(temporary, target)
  return settings
}

// The write-safe root is the ONLY env the managed runtime injects for the
// sandbox. HERMES_WRITE_SAFE_ROOT gates write_file/patch/delete/move only — it
// never restricts reads or terminal execution. It is meaningful only in the
// local 'guard' tier; 'off' injects nothing and 'docker' governs writes through
// bind-mount permissions instead. Multiple writable roots are joined with the
// platform path delimiter.
function writeRootEnv(settings = readSettings()) {
  if (settings.mode !== 'partner' || settings.sandbox !== 'guard') return null
  const writable = settings.roots.filter(root => root.access === 'rw').map(root => root.path)
  if (writable.length === 0) return null
  return writable.join(path.delimiter)
}

module.exports = {
  DEFAULT_SETTINGS,
  MODES,
  SANDBOX,
  ACCESS,
  settingsPath,
  normalizeSettings,
  readSettings,
  writeSettings,
  writeRootEnv
}
