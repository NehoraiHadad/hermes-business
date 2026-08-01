// The OFFICIAL desktop-plugin install contract, into a caller-supplied HERMES_HOME.
// This is byte-for-byte the same on-disk door the shipped app uses
// (electron/plugin-install.cjs installDesktopPlugin + scripts/install-plugin.mjs):
//   1. copy the repo plugin.js       -> <home>/desktop-plugins/business-shell/plugin.js
//   2. copy the business-bootstrap Skill -> <home>/skills/productivity/business-bootstrap/SKILL.md
//   3. write an integrity receipt    -> <home>/desktop-plugins/business-shell/install-receipt.json
// The renderer's runtime loader (contrib/runtime-loader.ts) then discovers (1) from
// the desktop-plugins directory. Copying to that directory IS the contract — there
// is no separate "enable" CLI; discovery + defaultEnabled do the enabling.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const here = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.resolve(here, '../../../..')

export const PLUGIN_ID = 'business-shell'
export const BOOTSTRAP_SKILL = 'business-bootstrap'

const pluginSource = path.join(repoRoot, 'hermes-plugin', 'business-shell', 'plugin.js')
const skillSource = path.join(repoRoot, 'hermes-plugin', 'business-shell', 'skills', BOOTSTRAP_SKILL, 'SKILL.md')
const backendSourceDir = path.join(repoRoot, 'hermes-plugin', 'business-shell', 'dashboard')
const BACKEND_FILES = ['manifest.json', 'plugin_api.py']

function sri(bytes) {
  return `sha256-${createHash('sha256').update(bytes).digest('base64')}`
}

/** Install via the official disk-door contract into `home`. Returns paths + integrity. */
export function installBusinessShell(home) {
  if (!existsSync(pluginSource) || !existsSync(skillSource)) {
    throw new Error('repository plugin.js or business-bootstrap SKILL.md is missing')
  }
  const targetDir = path.join(home, 'desktop-plugins', PLUGIN_ID)
  const target = path.join(targetDir, 'plugin.js')
  const skillTarget = path.join(home, 'skills', 'productivity', BOOTSTRAP_SKILL, 'SKILL.md')
  const pluginBytes = readFileSync(pluginSource)
  const skillBytes = readFileSync(skillSource)
  mkdirSync(targetDir, { recursive: true })
  writeFileSync(target, pluginBytes)
  mkdirSync(path.dirname(skillTarget), { recursive: true })
  writeFileSync(skillTarget, skillBytes)
  const integrity = sri(pluginBytes)
  const receipt = {
    id: PLUGIN_ID,
    installedAt: new Date().toISOString(),
    integrity,
    bootstrapSkill: skillTarget,
    bootstrapSkillIntegrity: sri(skillBytes)
  }
  const receiptPath = path.join(targetDir, 'install-receipt.json')
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  return { targetDir, target, skillTarget, receiptPath, integrity, pluginBytes, source: pluginSource }
}

/** Remove ONLY the plugin folder — mirrors the runtime loader's folder-deleted
 *  reconciliation (dropPlugin). The Skill has a distinct lifecycle and stays. */
export function uninstallBusinessShell(home) {
  rmSync(path.join(home, 'desktop-plugins', PLUGIN_ID), { recursive: true, force: true })
}

/** Add `id` to `plugins.enabled` in `<home>/config.yaml`, the exact allow-list
 *  the web server's dashboard-plugin mount gate reads
 *  (hermes_cli/plugins_cmd.py::_get_enabled_set, consumed by
 *  _mount_plugin_api_routes / _plugin_api_runtime_gate). A dashboard-only plugin
 *  isn't agent-discoverable, so `hermes plugins enable` can't resolve it — the
 *  config allow-list is the sanctioned enable for a backend-route plugin. Mirrors
 *  cmd_enable exactly: adds to plugins.enabled AND drops from plugins.disabled
 *  (disabled precedence would otherwise block a both-listed plugin from loading). */
export function enablePluginInConfig(home, id) {
  const configPath = path.join(home, 'config.yaml')
  let config = {}
  if (existsSync(configPath)) {
    let loaded
    try {
      loaded = yaml.load(readFileSync(configPath, 'utf8'))
    } catch {
      throw new Error(`Refusing to overwrite ${configPath}: it is not valid YAML.`)
    }
    if (loaded == null) config = {}
    else if (typeof loaded === 'object' && !Array.isArray(loaded)) config = loaded
    else throw new Error(`Refusing to overwrite ${configPath}: it is not a YAML mapping.`)
  }
  const plugins =
    config.plugins && typeof config.plugins === 'object' && !Array.isArray(config.plugins) ? config.plugins : {}
  const enabled = Array.isArray(plugins.enabled) ? plugins.enabled : []
  if (!enabled.includes(id)) enabled.push(id)
  plugins.enabled = enabled
  // Mirror `hermes plugins enable`: enabled.add(id) AND disabled.discard(id).
  // Hermes' disabled list takes precedence, so an id left in disabled would never
  // load even after being added to enabled.
  plugins.disabled = Array.isArray(plugins.disabled) ? plugins.disabled.filter(entry => entry !== id) : []
  config.plugins = plugins
  writeFileSync(configPath, yaml.dump(config), 'utf8')
  return configPath
}

/** Install the companion READ-ONLY backend plugin — the paused-inclusive source
 *  of truth — via the official dashboard-plugin contract, then enable it. Files
 *  land under `<home>/plugins/business-shell/dashboard/`; Hermes' web server
 *  mounts the router at `/api/plugins/business-shell/` at startup (behind the
 *  same dashboard auth as every /api route). Idempotent + transactional: the
 *  copy and the enable happen together so a half-install can't leave a mounted
 *  route the client can't reach or vice-versa. */
export function installBusinessShellBackend(home) {
  const targetDir = path.join(home, 'plugins', PLUGIN_ID, 'dashboard')
  mkdirSync(targetDir, { recursive: true })
  const files = {}
  for (const name of BACKEND_FILES) {
    const src = path.join(backendSourceDir, name)
    if (!existsSync(src)) throw new Error(`companion backend payload missing: ${name}`)
    const dest = path.join(targetDir, name)
    writeFileSync(dest, readFileSync(src))
    files[name] = dest
  }
  const configPath = enablePluginInConfig(home, PLUGIN_ID)
  return { targetDir, files, configPath, namespace: `/api/plugins/${PLUGIN_ID}`, enabledVia: 'config.yaml plugins.enabled' }
}

/** Remove ONLY the companion backend plugin folder. The config allow-list entry
 *  is harmless without the files (the mount gate simply finds nothing to mount)
 *  and the isolated home is discarded wholesale after the run. */
export function uninstallBusinessShellBackend(home) {
  rmSync(path.join(home, 'plugins', PLUGIN_ID), { recursive: true, force: true })
}

/** Enumerate `<home>/desktop-plugins/<name>/plugin.js` — the exact set the
 *  renderer's scanDiskPlugins() walks. */
export function scanDesktopPlugins(home) {
  const root = path.join(home, 'desktop-plugins')
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({ name: entry.name, file: path.join(root, entry.name, 'plugin.js') }))
    .filter(entry => existsSync(entry.file))
}
