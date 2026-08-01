// HIGH 6 — the prior-release ledger and the publisher allowlist must be
// AUTHENTICATED, not trusted because of a self-applied label.
//
// A file that merely claims `"source": "signed-ledger"` proves nothing — anyone can
// write that string. Authenticity requires binding to a TRUST ROOT the release
// operator committed out-of-band:
//   * a detached signature over the ledger body verifiable by a committed public
//     key (trustRoots.ledger_pubkeys), OR
//   * a GitHub release-asset digest/attestation whose recorded sha256 matches a
//     committed known-good digest (trustRoots.github_asset_sha256[version]).
// The signature/digest check is INJECTED (verifySignature) so the pure decision is
// testable without crypto material; a forged signature or an unknown key/digest is
// rejected. With NO trust root configured, public fails closed — an unauthenticated
// ledger is treated as ABSENT, never as trusted.

export const PROVENANCE_KINDS = new Set(['signed-ledger', 'github-asset'])

/**
 * @param artifact       the ledger (or allowlist) object with an embedded provenance
 *                       block: { source, signature?, signed_by?, asset_sha256?, version? }
 * @param trustRoots     { ledger_pubkeys:[keyId], github_asset_sha256:{ [version]:sha } }
 * @param verifySignature (body, signature, keyId) => boolean  — injected verifier
 * @param body           canonical string the signature covers (the artifact sans
 *                       its `signature` field)
 * Returns { authenticated, source, reason }.
 */
export function authenticateProvenance({ artifact, trustRoots = {}, verifySignature, body } = {}) {
  if (!artifact || typeof artifact !== 'object') return notAuth('no-artifact')
  const source = artifact.source
  if (!PROVENANCE_KINDS.has(source)) return notAuth(`unknown-source:${source}`)

  if (source === 'signed-ledger') {
    const keys = trustRoots.ledger_pubkeys || []
    if (!keys.length) return notAuth('no-trust-root: no committed ledger public key')
    if (!artifact.signature) return notAuth('no-signature on a ledger claiming to be signed')
    const keyId = artifact.signed_by
    if (!keys.includes(keyId)) return notAuth(`signer key ${keyId || 'unknown'} is not a committed trust root`)
    if (typeof verifySignature !== 'function' || !verifySignature(body, artifact.signature, keyId)) {
      return notAuth('ledger signature does not verify against the trusted key (forged/tampered)')
    }
    return { authenticated: true, source, reason: '' }
  }

  // github-asset: the recorded asset digest must equal a committed known-good digest.
  const known = (trustRoots.github_asset_sha256 || {})[artifact.version]
  if (!known) return notAuth(`no committed known-good GitHub asset digest for v${artifact.version}`)
  if (!artifact.asset_sha256) return notAuth('ledger records no GitHub asset_sha256')
  if (artifact.asset_sha256 !== known) return notAuth(`GitHub asset digest ${short(artifact.asset_sha256)} != committed trust root ${short(known)}`)
  return { authenticated: true, source, reason: '' }
}

/** Convenience: authenticated ledger or null, for feeding into checkVersionImmutability. */
export function authenticatedLedgerOrNull(opts) {
  return authenticateProvenance(opts).authenticated ? opts.artifact : null
}

function notAuth(reason) { return { authenticated: false, source: null, reason } }
function short(h) { return typeof h === 'string' ? h.slice(0, 12) + '…' : String(h) }
