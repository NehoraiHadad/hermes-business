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

const here = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.resolve(here, '../../../..')

export const PLUGIN_ID = 'business-shell'
export const BOOTSTRAP_SKILL = 'business-bootstrap'

const pluginSource = path.join(repoRoot, 'hermes-plugin', 'business-shell', 'plugin.js')
const skillSource = path.join(repoRoot, 'hermes-plugin', 'business-shell', 'skills', BOOTSTRAP_SKILL, 'SKILL.md')

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
