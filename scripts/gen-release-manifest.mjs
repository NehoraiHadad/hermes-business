// Embed the canonical release manifest INTO the packaged payload.
//
// Run during packing (from after-pack.cjs, once win-unpacked/resources/app.asar +
// build-attestation.json exist, BEFORE electron-builder compresses the NSIS
// payload) so the manifest is genuinely inside the installer — not a loose
// win-unpacked side file. It binds the app.asar hash, the embedded attestation
// facts (incl. the build_nonce the running app echoes), the per-category evidence
// digests, and version/commit/subject. The post-package report (gen-release-report)
// ties the installer SHA to this manifest and proves containment.
//
//   node scripts/gen-release-manifest.mjs [<win-unpacked-dir>]

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { repoRoot, currentHead } from './lib/source-fingerprint.mjs'
import { readAttestation, unpackedDir } from './lib/build-attestation.mjs'
import { subjectFingerprint } from './lib/evidence-subject.mjs'
import { CATEGORIES } from './lib/subject-registry.mjs'
import { buildReleaseManifest } from './lib/release/manifest.mjs'

export function embedReleaseManifest(appOutDir, root = repoRoot()) {
  const attestation = readAttestation(appOutDir)
  if (!attestation) throw new Error(`no build-attestation.json under ${appOutDir}/resources — run gen-build-attestation first`)
  const asarPath = path.join(appOutDir, 'resources', 'app.asar')
  if (!existsSync(asarPath)) throw new Error(`no app.asar under ${appOutDir}/resources`)
  const asarBuf = readFileSync(asarPath)
  const appAsar = { bytes: asarBuf.length, sha256: createHash('sha256').update(asarBuf).digest('hex') }

  const evidenceDigests = {}
  for (const cat of CATEGORIES) {
    try { evidenceDigests[cat] = subjectFingerprint(root, cat).fingerprint } catch { /* missing subject → omitted */ }
  }
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  let subject = ''
  try { subject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: root }).toString().trim() } catch { /* off-git */ }

  const manifest = buildReleaseManifest({ version: pkg.version, commit: currentHead(root), subject, attestation, appAsar, evidenceDigests })
  const json = `${JSON.stringify(manifest, null, 2)}\n`
  writeFileSync(path.join(appOutDir, 'resources', 'release-manifest.json'), json)
  mkdirSync(path.join(root, 'build'), { recursive: true })
  writeFileSync(path.join(root, 'build', 'release-manifest.json'), json)
  return manifest
}

if (process.argv[1]?.endsWith('gen-release-manifest.mjs')) {
  const root = repoRoot()
  const dir = process.argv[2] ? path.resolve(process.argv[2]) : unpackedDir(root)
  const m = embedReleaseManifest(dir, root)
  console.log(`Embedded resources/release-manifest.json — app ${m.version}, nonce ${String(m.build_nonce).slice(0, 8)}…, app.asar ${m.app_asar.sha256.slice(0, 16)}…`)
}
