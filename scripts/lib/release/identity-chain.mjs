// HIGH 7 — ONE build identity chain. Every artifact in a release must describe the
// SAME build; a report cut against build A must never be promoted next to an
// attestation from build B and evidence from build C.
//
// The chain is pinned on the per-build NONCE and the source identity:
//   attestation.build_nonce == manifest.build_nonce == evidence packaged-e2e nonce
//   manifest.commit          == attestation.source_head
//   manifest.attestation.source_fingerprint == attestation.source_fingerprint
//   report.release_binding_digest == build.release_binding_digest (the tested one)
// Any divergence is a spliced/mixed build and fails closed. This consolidates checks
// that were previously spread across verifyReleaseReport + checkPackagedBinding into
// one explicit, adversarially-tested identity assertion.

/**
 * @param attestation      embedded build-attestation.json
 * @param manifest         report.manifest (embedded release manifest)
 * @param evidenceBinding  packaged-e2e envelope binding { build_nonce, release_binding_digest, installer_sha256 }
 * @param build            the current artifact's { build_nonce, release_binding_digest, installer_sha256 }
 * Returns { ok, failures:[{code,detail}], nonce }.
 */
export function verifyIdentityChain({ attestation, manifest, evidenceBinding, build } = {}) {
  const failures = []
  const add = (code, detail) => failures.push({ code, detail })

  const aNonce = attestation?.build_nonce ?? null
  const mNonce = manifest?.build_nonce ?? null
  const eNonce = evidenceBinding?.build_nonce ?? null
  const bNonce = build?.build_nonce ?? null

  if (!aNonce) add('identity-no-nonce', 'build-attestation carries no build_nonce to anchor the identity chain')
  // manifest nonce must equal attestation nonce
  if (aNonce && mNonce && aNonce !== mNonce) add('identity-nonce-split', `manifest build_nonce ${short(mNonce)} != attestation ${short(aNonce)} (spliced build)`)
  // evidence nonce must equal the attestation/manifest nonce
  if (aNonce && eNonce && aNonce !== eNonce) add('identity-nonce-split', `evidence build_nonce ${short(eNonce)} != attestation ${short(aNonce)} (evidence from another build)`)
  if (aNonce && bNonce && aNonce !== bNonce) add('identity-nonce-split', `current-build nonce ${short(bNonce)} != attestation ${short(aNonce)}`)

  // source identity ties
  if (manifest?.commit && attestation?.source_head && manifest.commit !== attestation.source_head) {
    add('identity-commit-split', `manifest commit ${short(manifest.commit)} != attestation source_head ${short(attestation.source_head)}`)
  }
  if (manifest?.attestation?.source_fingerprint && attestation?.source_fingerprint && manifest.attestation.source_fingerprint !== attestation.source_fingerprint) {
    add('identity-fingerprint-split', 'manifest attestation fingerprint != embedded attestation fingerprint')
  }
  // artifact-hash tie: the binding digest the evidence tested must be the released one
  if (evidenceBinding?.release_binding_digest && build?.release_binding_digest && evidenceBinding.release_binding_digest !== build.release_binding_digest) {
    add('identity-binding-split', `evidence release_binding_digest ${short(evidenceBinding.release_binding_digest)} != current build ${short(build.release_binding_digest)}`)
  }

  return { ok: failures.length === 0, failures, nonce: aNonce }
}

function short(h) { return typeof h === 'string' ? h.slice(0, 12) + '…' : String(h) }
