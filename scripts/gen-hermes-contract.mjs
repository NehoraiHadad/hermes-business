// Generate the checked-in Hermes Desktop contract snapshot FROM the real source.
//
// Source of truth: the git-tracked Desktop plugin source of an installed Hermes,
// resolved through electron/paths.cjs (hermesHome) — the exact same install the
// product ships against. This is the local, network-free acquisition path; the
// clean-room equivalent is the official immutable release-source fetch in
// installer/bootstrap (ReleaseSelection.ps1 reads files at an immutable tag via
// the GitHub contents API). Either way the snapshot is DERIVED, never authored.
//
// Run:  node scripts/gen-hermes-contract.mjs
// Fails closed if Hermes is absent, its version is outside the supported range,
// or a required source file/symbol is missing — it never emits a partial or
// simulated contract.

import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HERMES_COMPAT_RANGE } from './plugin-sdk-contract.mjs'
import {
  CONTRACT_FILES,
  DISCOVERY,
  REPOSITORY,
  SCHEME_VERSION,
  checkRequirements,
  contractFilePath,
  extractPluginRequirements,
  fileSha256,
  readContractSources,
  readInstalledVersion,
  versionInRange
} from './lib/hermes-desktop-contract.mjs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const { hermesHome } = require(path.join(repoRoot, 'electron', 'paths.cjs'))

const home = hermesHome()
const version = readInstalledVersion(home)
if (!version) {
  console.error(`No installed Hermes found under ${home}; cannot generate a real-source contract.`)
  process.exit(1)
}
if (!versionInRange(version, HERMES_COMPAT_RANGE)) {
  console.error(`Installed Hermes ${version} is outside the supported range ${HERMES_COMPAT_RANGE}; refusing to snapshot.`)
  process.exit(1)
}

const pluginSource = readFileSync(path.join(repoRoot, 'hermes-plugin', 'business-shell', 'plugin.js'), 'utf8')
const requirements = extractPluginRequirements(pluginSource)
const sources = readContractSources(home)
const failures = checkRequirements(requirements, sources)
if (failures.length) {
  console.error('Real Hermes source does not satisfy the plugin contract:')
  console.error(failures.map(f => `- ${f}`).join('\n'))
  process.exit(1)
}

const sourceFiles = {}
for (const [key, rel] of Object.entries(CONTRACT_FILES)) {
  sourceFiles[rel] = { key, sha256: fileSha256(contractFilePath(home, key)) }
}

const snapshot = {
  schemeVersion: SCHEME_VERSION,
  compatRange: HERMES_COMPAT_RANGE,
  generatedFrom: {
    mechanism: 'installed-hermes-desktop-source',
    repository: REPOSITORY,
    hermesVersion: version
  },
  discovery: DISCOVERY,
  requirements,
  sourceFiles
}

const out = path.join(repoRoot, 'scripts', 'hermes-desktop-contract.json')
writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`)
console.log(`Wrote ${path.relative(repoRoot, out)} from real Hermes ${version} source.`)
