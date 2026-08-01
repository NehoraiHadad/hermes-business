import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const source = join(root, 'hermes-plugin', 'business-shell', 'plugin.js')
const bootstrapSkillSource = join(
  root,
  'hermes-plugin',
  'business-shell',
  'skills',
  'business-bootstrap',
  'SKILL.md'
)
const profile = process.env.HERMES_PROFILE?.trim()
const baseHome =
  process.env.HERMES_HOME?.trim() ||
  (process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Local'), 'hermes')
    : join(process.env.HOME || '', '.hermes'))
const hermesHome = profile ? join(baseHome, 'profiles', profile) : baseHome
const targetDir = join(hermesHome, 'desktop-plugins', 'business-shell')
const target = join(targetDir, 'plugin.js')
const bootstrapSkillDir = join(hermesHome, 'skills', 'productivity', 'business-bootstrap')
const bootstrapSkillTarget = join(bootstrapSkillDir, 'SKILL.md')
const configPath = join(hermesHome, 'config.yaml')
const backendSourceDir = join(root, 'hermes-plugin', 'business-shell', 'dashboard')
const backendTargetDir = join(hermesHome, 'plugins', 'business-shell', 'dashboard')
const BACKEND_FILES = ['manifest.json', 'plugin_api.py']

// Parse + validate the existing config BEFORE touching the filesystem. A malformed
// or non-mapping config.yaml is a real user config we must never clobber: ABORT
// (non-zero exit) and leave EVERY artifact (plugin, skill, backend, receipt,
// config) untouched rather than resetting the config to {} and overwriting it —
// or worse, copying files first and only then discovering the config is unsafe.
// Only an absent or empty document is treated as an empty config. This validation
// happens up front so a bad config produces zero new artifacts.
function loadValidatedConfig() {
  if (!existsSync(configPath)) return {}
  let loaded
  try {
    loaded = yaml.load(readFileSync(configPath, 'utf8'))
  } catch {
    throw new Error(`Refusing to overwrite ${configPath}: it is not valid YAML. Fix or remove it, then re-run.`)
  }
  if (loaded == null) return {}
  if (typeof loaded === 'object' && !Array.isArray(loaded)) return loaded
  throw new Error(`Refusing to overwrite ${configPath}: it is not a YAML mapping. Fix or remove it, then re-run.`)
}

// Validate FIRST — before any mkdir/copy/write. If this throws nothing is created.
const config = loadValidatedConfig()

// Now that the config is known safe, perform all filesystem mutations.
await mkdir(targetDir, { recursive: true })
await cp(source, target)
await mkdir(bootstrapSkillDir, { recursive: true })
await cp(bootstrapSkillSource, bootstrapSkillTarget)

const bytes = await readFile(target)
const digest = createHash('sha256').update(bytes).digest('base64')
const receipt = {
  id: 'business-shell',
  installedAt: new Date().toISOString(),
  source,
  target,
  bootstrapSkill: bootstrapSkillTarget,
  integrity: `sha256-${digest}`
}
await writeFile(join(targetDir, 'install-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')

// Companion READ-ONLY backend plugin: the paused-inclusive source of truth.
// Hermes' web server mounts <home>/plugins/business-shell/dashboard/plugin_api.py
// at /api/plugins/business-shell/, reachable by the desktop plugin's
// namespace-locked ctx.rest. A dashboard-only plugin isn't agent-discoverable,
// so `hermes plugins enable` can't resolve it — enable it directly in the
// config.yaml allow-list the mount gate reads (_get_enabled_set).
await mkdir(backendTargetDir, { recursive: true })
for (const name of BACKEND_FILES) {
  await cp(join(backendSourceDir, name), join(backendTargetDir, name))
}

// Enable mirrors `hermes plugins enable` (cmd_enable) exactly: add the id to
// plugins.enabled AND remove it from plugins.disabled. Hermes' disabled list takes
// precedence, so an id left in disabled would never load even once enabled.
const plugins =
  config.plugins && typeof config.plugins === 'object' && !Array.isArray(config.plugins) ? config.plugins : {}
const enabledPlugins = Array.isArray(plugins.enabled) ? plugins.enabled : []
if (!enabledPlugins.includes('business-shell')) enabledPlugins.push('business-shell')
plugins.enabled = enabledPlugins
plugins.disabled = Array.isArray(plugins.disabled) ? plugins.disabled.filter(id => id !== 'business-shell') : []
config.plugins = plugins
writeFileSync(configPath, yaml.dump(config), 'utf8')

console.log(`Installed Hermes Business Shell:\n${target}`)
console.log(`Installed + enabled companion backend:\n${backendTargetDir} (/api/plugins/business-shell)`)
console.log(`Installed first-run Skill:\n${bootstrapSkillTarget}`)
console.log('Open Hermes Desktop and choose “לעסק” in the sidebar. Changes hot-reload automatically.')
