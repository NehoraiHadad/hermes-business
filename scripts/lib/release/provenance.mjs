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
 *                       block: { source, signature?, signed_by?, entries? } —
 *                       github-asset ledgers carry { entries: { [version]: { sha256 } } }
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

  // github-asset: authenticate the ledger PER ENTRY against the committed trust
  // roots, in BOTH directions:
  //   * every ledger entry's sha256 must equal the committed known-good digest
  //     for that version (a tampered/unknown entry rejects the whole ledger);
  //   * every committed trust-root version must appear in the ledger (a dropped
  //     entry would silently re-open that version for reuse — the ledger is
  //     never-shrinking).
  // An EMPTY ledger with EMPTY committed roots authenticates: that is the
  // explicit, committed statement "no releases exist yet" (the first-release
  // bootstrap, docs/RELEASING.md step 0) — while a ledger with no committed
  // github_asset_sha256 object at all stays unauthenticated (no trust root).
  const entries = artifact.entries
  if (!entries || typeof entries !== 'object') return notAuth('github-asset ledger has no entries object')
  const roots = trustRoots.github_asset_sha256
  if (!roots || typeof roots !== 'object') return notAuth('no committed github_asset_sha256 trust roots (build/trust-roots.json)')
  for (const version of Object.keys(roots)) {
    if (!entries[version]) return notAuth(`committed trust root records v${version} but the ledger omits it (never-shrinking violated)`)
  }
  for (const [version, entry] of Object.entries(entries)) {
    const known = roots[version]
    if (!known) return notAuth(`no committed known-good GitHub asset digest for v${version}`)
    if (!entry || !entry.sha256) return notAuth(`ledger entry v${version} records no sha256`)
    if (entry.sha256 !== known) return notAuth(`GitHub asset digest for v${version} ${short(entry.sha256)} != committed trust root ${short(known)}`)
  }
  return { authenticated: true, source, reason: '' }
}

/** Convenience: authenticated ledger or null, for feeding into checkVersionImmutability. */
export function authenticatedLedgerOrNull(opts) {
  return authenticateProvenance(opts).authenticated ? opts.artifact : null
}

function notAuth(reason) { return { authenticated: false, source: null, reason } }
function short(h) { return typeof h === 'string' ? h.slice(0, 12) + '…' : String(h) }
