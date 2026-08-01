// The canonical, tamper-evident release manifest + outer release report.
//
// TWO artifacts, deliberately split to avoid a circular digest (an installer
// cannot contain its own hash):
//
//   * MANIFEST — written into build/ and copied via extraResources into the
//     packaged `resources/` BEFORE electron-builder compresses win-unpacked into
//     the NSIS installer. It binds the packaged CONTENT: the app.asar hash, the
//     embedded attestation facts (incl. the build_nonce the running app echoes),
//     the per-category evidence digests, and version/commit/subject. Its digest is
//     sha256 over the manifest BODY only — never over itself.
//
//   * REPORT — written into release/ AFTER packaging. It carries the manifest, the
//     manifest_digest, the measured installer set (name/bytes/sha256) and a
//     release_binding_digest = sha256(manifest_digest ∥ installers). The installer
//     bytes are bound to the manifest here, and the manifest lives INSIDE those
//     bytes, so tampering either side breaks the report. Payload CONTAINMENT (that
//     the compressed NSIS payload really holds this manifest) can only be PROVEN
//     with an NSIS extractor; when none is available we say so and fail closed for
//     public (see preflight `payload-binding-unproven`).

import { createHash } from 'node:crypto'
import { canonicalJson } from './binding.mjs'

export const MANIFEST_SCHEMA = 1

function sha(s) {
  return createHash('sha256').update(s).digest('hex')
}

/** Build the embedded release manifest (packaged-content binding). This is what is
 * written INTO the payload before packaging, so it can NOT carry any post-package
 * fact (installer sha, containment proof) — those live on the report. */
export function buildReleaseManifest({ version, commit, subject, attestation, appAsar, evidenceDigests = {} } = {}) {
  return {
    schema: MANIFEST_SCHEMA,
    version: version ?? null,
    commit: commit ?? null,
    subject: (subject || '').trim(),
    build_nonce: attestation?.build_nonce ?? null,
    attestation: attestation
      ? { app_version: attestation.app_version, source_head: attestation.source_head, source_fingerprint: attestation.source_fingerprint, artifact_kind: attestation.artifact_kind }
      : null,
    app_asar: appAsar ? { bytes: appAsar.bytes, sha256: appAsar.sha256 } : null,
    evidence: Object.fromEntries(Object.keys(evidenceDigests).sort().map(k => [k, evidenceDigests[k]]))
  }
}

/** Digest over the manifest BODY (order-independent). Not stored in the manifest. */
export function manifestDigest(manifest) {
  return sha(canonicalJson(manifest))
}

/** release_binding_digest ties the manifest digest to the exact installer bytes. */
export function releaseBindingDigest(mDigest, installers = []) {
  const norm = [...installers].map(i => ({ name: i.name, bytes: i.bytes, sha256: i.sha256 })).sort((a, b) => a.name.localeCompare(b.name))
  return sha(`${mDigest}\n${canonicalJson(norm)}`)
}

/** Build the outer release report from a manifest + measured installers + the
 * post-package payload-containment proof. `payloadBinding` records whether the
 * NSIS payload was proven to CONTAIN this manifest — proven only when an extractor
 * was available; otherwise { proven:false, reason:'no-nsis-extractor' } and the
 * public gate fails closed. */
export function buildReleaseReport({ manifest, installers = [], payloadBinding } = {}) {
  const mDigest = manifestDigest(manifest)
  const norm = [...installers].map(i => ({ name: i.name, bytes: i.bytes, sha256: i.sha256 })).sort((a, b) => a.name.localeCompare(b.name))
  return {
    schema: MANIFEST_SCHEMA,
    manifest,
    manifest_digest: mDigest,
    installers: norm,
    release_binding_digest: releaseBindingDigest(mDigest, norm),
    // CRITICAL 1: normalize the payload binding so `containment_digest`/`extracted`
    // are always present (from proveContainmentBound). The final verifier re-derives
    // both from the installer bytes — these recorded fields are only bound against,
    // never trusted alone.
    payload_binding: normalizePayloadBinding(payloadBinding)
  }
}

function normalizePayloadBinding(pb) {
  if (!pb) return { proven: false, method: 'none', reason: 'no-nsis-extractor', containment_digest: null, extracted: null }
  return {
    proven: pb.proven === true,
    method: pb.method || 'none',
    reason: pb.reason || '',
    containment_digest: pb.digest ?? pb.containment_digest ?? null,
    extracted: pb.extracted ?? null
  }
}

/**
 * Verify a release report against freshly-observed disk facts. Fails closed on:
 * a tampered report (recomputed digests disagree), an installer set that does not
 * match the report, an app.asar / attestation / evidence-digest drift, an absent
 * build_nonce, or an embedded manifest that differs from the report's manifest.
 *   observed { version, installers, appAsar, attestation, evidenceDigests, embeddedManifest }
 */
export function verifyReleaseReport(report, observed = {}) {
  const errors = []
  if (!report || typeof report !== 'object' || !report.manifest) return { ok: false, errors: ['release report missing or malformed'] }
  const m = report.manifest

  // Tamper-evidence: recompute both digests from the report body.
  const mDigest = manifestDigest(m)
  if (mDigest !== report.manifest_digest) errors.push('manifest_digest does not match the manifest body (report tampered)')
  if (releaseBindingDigest(report.manifest_digest, report.installers || []) !== report.release_binding_digest) {
    errors.push('release_binding_digest does not match manifest_digest ∥ installers (report tampered)')
  }
  if (!m.build_nonce) errors.push('manifest carries no build_nonce')

  // The embedded (in-payload) manifest must equal the report's manifest.
  if (observed.embeddedManifest !== undefined) {
    if (canonicalJson(observed.embeddedManifest) !== canonicalJson(m)) {
      errors.push('embedded resources/release-manifest.json differs from the release report (loose win-unpacked)')
    }
  }

  // The report must describe the bytes actually on disk now (TOCTOU re-check).
  if (observed.version != null && m.version !== observed.version) errors.push(`manifest version ${m.version} != current ${observed.version}`)
  if (observed.appAsar && m.app_asar && (m.app_asar.sha256 !== observed.appAsar.sha256 || m.app_asar.bytes !== observed.appAsar.bytes)) {
    errors.push('manifest app.asar hash/bytes disagree with the archive on disk')
  }
  if (observed.attestation && m.attestation && m.attestation.source_fingerprint !== observed.attestation.source_fingerprint) {
    errors.push('manifest attestation fingerprint disagrees with the embedded attestation')
  }
  const obsInst = observed.installers || []
  const repInst = report.installers || []
  if (obsInst.length !== repInst.length) errors.push(`report lists ${repInst.length} installer(s) but ${obsInst.length} on disk`)
  for (const ri of repInst) {
    const di = obsInst.find(d => d.name === ri.name)
    if (!di) { errors.push(`report installer ${ri.name} absent on disk`); continue }
    if (di.sha256 !== ri.sha256 || di.bytes !== ri.bytes) errors.push(`installer ${ri.name} bytes/hash changed since report (artifact mutated mid-run)`)
  }
  for (const [cat, dig] of Object.entries(m.evidence || {})) {
    if (observed.evidenceDigests && observed.evidenceDigests[cat] !== dig) errors.push(`evidence digest for "${cat}" drifted since the manifest was cut`)
  }
  return { ok: errors.length === 0, errors }
}
