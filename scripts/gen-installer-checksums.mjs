// Durable source of truth for installer byte-size + SHA-256 digests.
//
// These values are volatile: they change on every rebuild. Rather than pasting
// them into prose (where they rot the moment a new build is cut), this script
// computes them from the real release tree and writes a generated manifest that
// the docs point at. Run it after a build:
//
//   npm run checksums
//
// Output (git-ignored, next to the binaries):
//   release/SHA256SUMS.txt   — human-readable `sha256  size  name` table
//   release/checksums.json   — machine-readable manifest
//
// Nothing here is committed; the tracked docs reference this generator, not any
// specific digest, so they never make a claim that a later build falsifies.

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = path.join(root, 'release')

if (!existsSync(releaseDir)) {
  console.error(`No release/ directory at ${releaseDir}; build first (npm run package:win).`)
  process.exit(1)
}

const installers = readdirSync(releaseDir)
  .filter(name => name.toLowerCase().endsWith('.exe'))
  .sort()

if (installers.length === 0) {
  console.error('No installer .exe files found under release/.')
  process.exit(1)
}

const entries = installers.map(name => {
  const buffer = readFileSync(path.join(releaseDir, name))
  return {
    name,
    bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex')
  }
})

const table = entries.map(e => `${e.sha256}  ${String(e.bytes).padStart(12)}  ${e.name}`).join('\n')
writeFileSync(path.join(releaseDir, 'SHA256SUMS.txt'), `${table}\n`)
writeFileSync(
  path.join(releaseDir, 'checksums.json'),
  `${JSON.stringify({ generated_from: 'release/', installers: entries }, null, 2)}\n`
)

console.log(table)
console.log(`\nWrote release/SHA256SUMS.txt and release/checksums.json (${entries.length} installer(s)).`)
