// Build-attestation contract for the ISOLATED packaged E2E.
//
// WHY THIS EXISTS — the incident it closes:
//   `test:e2e:installed-isolated` resolved the companion executable through the
//   generic installed-app resolver, which defaults to
//   `%LOCALAPPDATA%\Programs\hermes-business\…exe` — the *installed* build. When
//   that installed build predated the QA-isolation namespace/runtime fixes, the
//   harness launched a STALE binary: `runtime_mode` never left `live`, the run
//   bound (or nearly bound) to the live gateway, and only the fail-fast
//   preconditions kept it from mutating the live profile. A safe abort is still a
//   failed run.
//
// The fix is twofold:
//   1. resolvePackagedArtifact() targets ONLY release/win-unpacked from the
//      current working tree. There is NO installed-app fallback and no
//      HERMES_BUSINESS_EXE escape hatch — a stale installed build can never be
//      selected.
//   2. Every prepared artifact carries an attested manifest (app version + source
//      HEAD + a deterministic fingerprint of the packaged main-process sources +
//      a per-build nonce). verifyArtifactCurrent() recomputes the fingerprint over
//      the CURRENT working tree and refuses — BEFORE launch — any artifact whose
//      embedded manifest does not correspond to the source that is checked out
//      now. The same nonce is read back from the RUNNING app (electron/runtime QA
//      diagnostics), so the harness proves the launched binary is the attested one.
//
// The source fingerprinting + repo identity helpers live in source-fingerprint.mjs
// and are re-exported here so existing importers are unchanged.

import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  computeSourceFingerprint,
  currentHead,
  productExeName,
  repoRoot
} from './source-fingerprint.mjs'

export { repoRoot, listMainSources, computeSourceFingerprint, productExeName } from './source-fingerprint.mjs'

export const ATTESTATION_BASENAME = 'build-attestation.json'
export const ATTESTATION_SCHEMA = 1
export const ARTIFACT_KIND = 'win-unpacked-current'

/** Build the attestation manifest for the current working tree. */
export function buildAttestation(root = repoRoot()) {
  const { fingerprint, fileCount } = computeSourceFingerprint(root)
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const head = currentHead(root)
  return {
    schema: ATTESTATION_SCHEMA,
    artifact_kind: ARTIFACT_KIND,
    app_version: pkg.version,
    source_head: head,
    source_head_short: head === 'unknown' ? 'unknown' : head.slice(0, 12),
    source_fingerprint: fingerprint,
    source_file_count: fileCount,
    build_nonce: randomBytes(16).toString('hex'),
    generated_at: new Date().toISOString()
  }
}

/** Write the attestation manifest to `destFile`; returns the manifest. */
export function writeAttestation(destFile, root = repoRoot()) {
  const manifest = buildAttestation(root)
  writeFileSync(destFile, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

/** Absolute path to the win-unpacked directory in the working tree. */
export function unpackedDir(root = repoRoot()) {
  return path.join(root, 'release', 'win-unpacked')
}

/** Where the manifest lands inside a packaged artifact (extraResources root). */
export function attestationPathInUnpacked(dir) {
  return path.join(dir, 'resources', ATTESTATION_BASENAME)
}

/** Read the embedded manifest from a win-unpacked dir, or null if absent. */
export function readAttestation(dir) {
  try {
    return JSON.parse(readFileSync(attestationPathInUnpacked(dir), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Resolve the ONE artifact the isolated suite may launch: the product exe inside
 * release/win-unpacked of the current working tree. No installed-app fallback, no
 * env override — by construction a stale installed build cannot be selected.
 * Throws (fail-before-launch) if the prepared artifact is absent.
 */
export function resolvePackagedArtifact({ root = repoRoot() } = {}) {
  const dir = unpackedDir(root)
  if (!existsSync(dir)) {
    throw new Error(
      `packaged test artifact missing: release/win-unpacked not found. Run \`npm run build:test-packaged\` first.`
    )
  }
  const exe = path.join(dir, productExeName(root))
  if (!existsSync(exe)) {
    // Fall back to the largest non-uninstaller .exe so a productName change never
    // silently breaks resolution — but still ONLY inside win-unpacked.
    const candidates = readdirSync(dir)
      .filter(f => f.endsWith('.exe') && !/uninstall|elevate|crashpad/i.test(f))
      .map(f => ({ f, size: statSync(path.join(dir, f)).size }))
      .sort((a, b) => b.size - a.size)
    if (!candidates.length) {
      throw new Error(`no product executable inside release/win-unpacked`)
    }
    return { unpackedDir: dir, executablePath: path.join(dir, candidates[0].f), appDirectory: '' }
  }
  return { unpackedDir: dir, executablePath: exe, appDirectory: '' }
}

/**
 * Fail-before-launch attestation check. Reads the manifest embedded in the
 * prepared artifact and recomputes the fingerprint over the CURRENT working tree.
 * The artifact "corresponds to current source" only when the app version and the
 * source fingerprint both match. Returns a redaction-safe verdict — callers print
 * only the relative artifact path and a hash PREFIX.
 */
export function verifyArtifactCurrent({ dir, root = repoRoot() } = {}) {
  const reasons = []
  const manifest = readAttestation(dir)
  if (!manifest) {
    return { ok: false, attested: false, reasons: ['attestation-manifest-missing'], manifest: null }
  }
  if (manifest.schema !== ATTESTATION_SCHEMA) reasons.push('attestation-schema-mismatch')
  if (manifest.artifact_kind !== ARTIFACT_KIND) reasons.push('artifact-kind-unexpected')

  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  if (manifest.app_version !== pkg.version) reasons.push('app-version-mismatch')

  const { fingerprint } = computeSourceFingerprint(root)
  if (manifest.source_fingerprint !== fingerprint) reasons.push('source-fingerprint-mismatch')

  return {
    ok: reasons.length === 0,
    attested: reasons.length === 0,
    kind: manifest.artifact_kind,
    reasons,
    manifest,
    currentFingerprint: fingerprint,
    currentFingerprintPrefix: fingerprint.slice(0, 16)
  }
}
