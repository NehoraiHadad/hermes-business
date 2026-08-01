const fs = require('node:fs')
const path = require('node:path')
const { hermesHome, desktopBackendSourceDir, DESKTOP_BACKEND_FILES } = require('./paths.cjs')
const { safeWrite } = require('./atomic-write.cjs')

// Install + enable the READ-ONLY companion backend plugin so Hermes mounts
// /api/plugins/business-shell/ (the paused-inclusive source of truth the desktop
// plugin reaches via ctx.rest). Best-effort and non-fatal: a build that hasn't
// staged the payload, or a runtime without js-yaml, degrades to the active-only
// cron.manage door — it must never block the desktop plugin install. A
// dashboard-only plugin isn't agent-discoverable, so it is enabled by writing
// the config.yaml allow-list the mount gate reads (_get_enabled_set), the same
// key `hermes plugins enable` would set for an agent plugin.
function installCompanionBackend() {
  try {
    const sourceDir = desktopBackendSourceDir()
    for (const name of DESKTOP_BACKEND_FILES) {
      if (!fs.existsSync(path.join(sourceDir, name))) {
        return { ok: false, reason: `payload missing: ${name}` }
      }
    }
    const home = hermesHome()
    const targetDir = path.join(home, 'plugins', 'business-shell', 'dashboard')
    // Snapshot everything the transaction mutates BEFORE any write, so a failed
    // payload commit can roll the config enablement (and any prior backend files)
    // back to their exact preexisting bytes — never leaving a config that claims
    // an installed door with no files behind it.
    const configSnapshot = snapshotFile(path.join(home, 'config.yaml'))
    const dirExisted = fs.existsSync(targetDir)
    const fileSnapshots = DESKTOP_BACKEND_FILES.map(name => {
      const target = path.join(targetDir, name)
      return { target, before: snapshotFile(target) }
    })
    // Enable in config FIRST. If the user's config.yaml is malformed or not a
    // mapping we fail closed WITHOUT touching it (and without staging dashboard
    // files that could never be mounted) — a copied-but-unenabled payload is a
    // misleading "installed" with no working door.
    const enabled = enableBackendInConfig()
    if (!enabled) {
      return {
        ok: false,
        enabled: false,
        reason: 'config not enabled (no js-yaml, or existing config.yaml is unreadable/not a mapping)'
      }
    }
    try {
      fs.mkdirSync(targetDir, { recursive: true })
      for (const name of DESKTOP_BACKEND_FILES) {
        fs.writeFileSync(path.join(targetDir, name), fs.readFileSync(path.join(sourceDir, name)), { mode: 0o600 })
      }
    } catch (commitError) {
      // Payload commit failed after the config was enabled: roll BOTH back so no
      // partial state survives — config to its preexisting bytes, backend files
      // to their prior contents (or removed if they/the dir did not exist).
      restoreFile(path.join(home, 'config.yaml'), configSnapshot)
      for (const { target, before } of fileSnapshots) restoreFile(target, before)
      if (!dirExisted) fs.rmSync(targetDir, { recursive: true, force: true })
      return { ok: false, reason: `backend commit failed, rolled back: ${String((commitError && commitError.message) || commitError)}` }
    }
    return { ok: true, targetDir, namespace: '/api/plugins/business-shell', enabled }
  } catch (error) {
    return { ok: false, reason: String((error && error.message) || error) }
  }
}

// Read a file's bytes, or null when it does not exist — a snapshot for rollback.
function snapshotFile(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null
}

// Restore a file from a snapshot: rewrite prior bytes, or delete a file that did
// not exist when the snapshot was taken.
function restoreFile(filePath, snapshot) {
  if (snapshot === null) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true })
  } else {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, snapshot)
  }
}

// Add business-shell to config.yaml's plugins.enabled allow-list, fail-closed.
// Returns true only when the config was safely enabled; false (and NEVER a write)
// when there is no YAML parser, or the existing config is malformed / not a
// mapping. An existing config the user owns must survive byte-for-byte unless we
// can parse it into a mapping — we never reset it to {} and overwrite it.
function enableBackendInConfig() {
  let yaml
  try {
    yaml = require('js-yaml')
  } catch {
    return false // no YAML parser in this runtime — degrade to active-only door
  }
  const configPath = path.join(hermesHome(), 'config.yaml')
  let config = {}
  let existingPlugins = null
  if (fs.existsSync(configPath)) {
    let loaded
    try {
      loaded = yaml.load(fs.readFileSync(configPath, 'utf8'))
    } catch {
      return false // malformed YAML — fail closed, never overwrite the user's config
    }
    if (loaded == null) {
      config = {} // an empty/whitespace document is a legitimate empty config
    } else if (typeof loaded === 'object' && !Array.isArray(loaded)) {
      config = loaded
      if (config.plugins && typeof config.plugins === 'object' && !Array.isArray(config.plugins)) {
        existingPlugins = config.plugins
      }
    } else {
      return false // a readable non-mapping config (list/scalar) — never clobber it
    }
  }
  const plugins = existingPlugins || {}
  const list = Array.isArray(plugins.enabled) ? plugins.enabled : []
  const disabled = Array.isArray(plugins.disabled) ? plugins.disabled : null
  // Already in the desired state → leave the file byte-for-byte unchanged. Desired
  // means: present in enabled AND absent from a well-formed disabled list. A config
  // with the id in BOTH lists is NOT already-correct (Hermes' disabled precedence
  // would block load), so it must be rewritten to drop the disabled entry.
  if (existingPlugins && list.includes('business-shell') && disabled && !disabled.includes('business-shell')) {
    return true
  }
  if (!list.includes('business-shell')) list.push('business-shell')
  plugins.enabled = list
  // Mirror `hermes plugins enable`: enabled.add(id) AND disabled.discard(id).
  plugins.disabled = disabled ? disabled.filter(id => id !== 'business-shell') : []
  config.plugins = plugins
  safeWrite(configPath, yaml.dump(config))
  return true
}

// Stage the companion backend payload (dashboard/manifest.json + plugin_api.py)
// alongside the desktop plugin so the PowerShell bootstrap installer can commit
// it transactionally. Packaged builds ship it under the business-bootstrap
// resource; the dev tree reads it from hermes-plugin/business-shell/dashboard.
function stageBackendPayload(sourceRoot, stagingRoot, isPackaged) {
  const sourceDir = isPackaged ? path.join(sourceRoot, 'dashboard') : desktopBackendSourceDir()
  const targetDir = path.join(stagingRoot, 'dashboard')
  fs.mkdirSync(targetDir, { recursive: true })
  for (const name of DESKTOP_BACKEND_FILES) {
    const source = path.join(sourceDir, name)
    if (!fs.existsSync(source)) throw new Error(`The packaged companion backend payload is missing: ${name}`)
    fs.copyFileSync(source, path.join(targetDir, name))
  }
}

module.exports = { installCompanionBackend, enableBackendInConfig, stageBackendPayload }
