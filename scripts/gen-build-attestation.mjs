// Generate the build attestation manifest consumed by the isolated packaged E2E.
//
// Run BEFORE electron-builder so the manifest is present when `build.extraResources`
// copies `build/build-attestation.json` into the packaged `resources/` root. The
// manifest fingerprints the packaged main-process sources of the CURRENT working
// tree, so the harness (and the running app) can prove the launched binary
// corresponds to the source that is checked out now.
//
// Prints only a redacted summary — the app version, a hash PREFIX and the short
// HEAD. Never the absolute path or the full fingerprint.

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { repoRoot, writeAttestation } from './lib/build-attestation.mjs'

const root = repoRoot()
const buildDir = path.join(root, 'build')
mkdirSync(buildDir, { recursive: true })
const dest = path.join(buildDir, 'build-attestation.json')
const manifest = writeAttestation(dest, root)

console.log(
  `Wrote build/build-attestation.json — app ${manifest.app_version}, ` +
    `head ${manifest.source_head_short}, fingerprint ${manifest.source_fingerprint.slice(0, 16)}…, ` +
    `${manifest.source_file_count} main sources, nonce ${manifest.build_nonce.slice(0, 8)}…, ` +
    `build_mode=${manifest.build_mode}`
)
if (manifest.build_mode === 'unknown') {
  console.log('  NOTE: build_mode could not be independently detected (dist/ missing or unreadable) — run this AFTER `vite build`/`vite build --mode qa`, not before. The pilot gate treats "unknown" as not-production.')
}
