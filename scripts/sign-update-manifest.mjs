#!/usr/bin/env node
// Sign the per-release update manifest — the runtime trust anchor the in-app
// one-click updater checks BEFORE it runs a downloaded installer.
//
//   node scripts/sign-update-manifest.mjs --channel pilot [--key <pem>] [--released-at YYYY-MM-DD]
//
// Inputs are the ones the packaging pipeline already produced and gated:
//   release/checksums.json  — installer name + byte length + sha256 (measured
//                             from the real bytes by gen-installer-checksums)
//   package.json            — the version being released
// Output:
//   release/update-manifest.json — { …, signature } upload it to the GitHub
//                             release alongside SHA256SUMS.txt (docs/RELEASING.md).
//
// The private key never comes from the repository: --key, else
// TACHLES_UPDATE_SIGNING_KEY, else %USERPROFILE%\.tachles-release\update-signing-key.pem.
//
// The output is SELF-VERIFIED before it is written (update-manifest.mjs
// signUpdateManifest): the freshly signed document is run through the exact
// verifier the shipped app uses, with the public keys from
// electron/update-trust.cjs. A signing step that can emit a manifest the app
// cannot verify would be worse than no signing step at all — it would look like a
// trust anchor while being one only on paper.
//
// Normally you do NOT need to run this by hand: finalize-release.mjs performs the
// same step inside the atomic sidecar transaction. Use this when re-signing an
// existing release tree (e.g. the key lives on a different machine than the build).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { repoRoot } from './lib/source-fingerprint.mjs'
import { parseChannel } from './lib/parse-channel.mjs'
import { prepareUpdateManifest, UPDATE_MANIFEST_FILE, resolveSigningKey } from './lib/release/update-signing.mjs'

const argv = process.argv.slice(2)
const root = repoRoot()
const releaseDir = path.join(root, 'release')

function flag(name) {
  const i = argv.indexOf(name)
  if (i === -1) return null
  const value = argv[i + 1]
  if (value === undefined || value.startsWith('--')) {
    console.error(`${name} requires a value`)
    process.exit(1)
  }
  return value
}

// The channel is RECORDED in the signed document, so it must be stated, never
// defaulted: a pilot release silently signed as `public` would be a signed lie.
if (!argv.includes('--channel')) {
  console.error('sign-update-manifest: --channel is required (public|qa|pilot) — it is part of the SIGNED document, so it is never guessed.')
  process.exit(1)
}
const channel = parseChannel(argv)

const checksumsPath = path.join(releaseDir, 'checksums.json')
if (!existsSync(checksumsPath)) {
  console.error(`No ${checksumsPath}; run the packaging pipeline (npm run package:win:${channel}) first.`)
  process.exit(1)
}
const checksums = JSON.parse(readFileSync(checksumsPath, 'utf8'))
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version
const ledger = existsSync(path.join(root, 'release-ledger.json'))
  ? JSON.parse(readFileSync(path.join(root, 'release-ledger.json'), 'utf8'))
  : null

const explicitKeyPath = flag('--key')
const key = resolveSigningKey({ explicitPath: explicitKeyPath })
if (!key.path) {
  console.error(`sign-update-manifest: ${key.reason}\n\n` +
    'Generate one with:  node scripts/gen-update-key.mjs\n' +
    'then paste its public key into electron/update-trust.cjs and rebuild.')
  process.exit(1)
}

const result = prepareUpdateManifest({
  root,
  version,
  channel,
  checksums,
  ledger,
  explicitKeyPath,
  ...(flag('--released-at') ? { releasedAt: flag('--released-at') } : {})
})

if (result.status !== 'signed') {
  console.error(`sign-update-manifest: FAILED [${result.code || result.status}] ${result.detail}`)
  process.exit(1)
}

const outPath = path.join(releaseDir, UPDATE_MANIFEST_FILE)
writeFileSync(outPath, result.json)
console.log(`Wrote ${outPath}\n  version   : ${result.manifest.version} (channel ${result.manifest.channel})\n` +
  `  installer : ${result.manifest.installer.name} (${result.manifest.installer.bytes} bytes)\n` +
  `  sha256    : ${result.manifest.installer.sha256}\n` +
  `  signed by : ${result.keyId}\n  ${result.detail}\n\n` +
  'Upload it to the GitHub release ALONGSIDE SHA256SUMS.txt (docs/RELEASING.md step 9).')
