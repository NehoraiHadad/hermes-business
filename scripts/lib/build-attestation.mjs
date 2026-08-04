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
// Bumped 1 → 2: the manifest now carries build_mode/demo_stub_detected (below).
// Any attestation written by an older generator lacks the field entirely, which
// the pilot gate (preflight.mjs) treats as "not proven production" — fail
// closed, never a silent pass-through of an un-attested fact.
export const ATTESTATION_SCHEMA = 2
export const ARTIFACT_KIND = 'win-unpacked-current'

// The literal error text `scripts/strip-demo-fixtures.mjs` bakes into the STUB
// module it substitutes for `src/lib/hermes/demo.ts` whenever a build does NOT
// allow the demo transport (i.e. every build except `vite build --mode qa` / the
// dev server). `hermes-client.ts` statically imports that module, so the STUB
// (or the real demo module) always ends up in the compiled dist/ bundle —
// scanning for this exact string is an INDEPENDENT, on-disk proof of which one
// shipped, never a trust of which npm script the caller claims to have run.
const DEMO_STUB_MARKER = 'demo fixtures are not shipped in this build'

/**
 * Independently detect whether the CURRENT dist/ build is a real production
 * build (demo fixtures physically stripped) or a qa-mode build (`--mode qa`,
 * demo fixtures compiled in). Never trusts an argument or an env var — it reads
 * the actual compiled bundle on disk, mirroring the same "prove it from bytes,
 * not from a claim" discipline as the rest of the release-attestation chain.
 * Returns { build_mode: 'production'|'qa'|'unknown', demo_stub_detected, reason }.
 */
export function detectBuildMode(root = repoRoot()) {
  const distDir = path.join(root, 'dist')
  if (!existsSync(distDir)) return { build_mode: 'unknown', demo_stub_detected: false, reason: 'dist-missing' }
  try {
    for (const file of walkJsFiles(distDir)) {
      if (readFileSync(file, 'utf8').includes(DEMO_STUB_MARKER)) {
        return { build_mode: 'production', demo_stub_detected: true, reason: 'demo-stub-present' }
      }
    }
  } catch {
    return { build_mode: 'unknown', demo_stub_detected: false, reason: 'dist-unreadable' }
  }
  return { build_mode: 'qa', demo_stub_detected: false, reason: 'demo-stub-absent' }
}

function walkJsFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walkJsFiles(full, out)
    else if (/\.(m|c)?js$/i.test(e.name)) out.push(full)
  }
  return out
}

/** Build the attestation manifest for the current working tree. */
export function buildAttestation(root = repoRoot()) {
  const { fingerprint, fileCount } = computeSourceFingerprint(root)
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const head = currentHead(root)
  const mode = detectBuildMode(root)
  return {
    schema: ATTESTATION_SCHEMA,
    artifact_kind: ARTIFACT_KIND,
    app_version: pkg.version,
    source_head: head,
    source_head_short: head === 'unknown' ? 'unknown' : head.slice(0, 12),
    source_fingerprint: fingerprint,
    source_file_count: fileCount,
    // Independently detected from the compiled dist/ bundle (see
    // detectBuildMode above) — NEVER a passthrough of --channel. 'unknown' when
    // dist/ is absent/unreadable (e.g. this function called before `vite build`
    // ran); the pilot gate treats anything other than 'production' as unproven.
    build_mode: mode.build_mode,
    demo_stub_detected: mode.demo_stub_detected,
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
