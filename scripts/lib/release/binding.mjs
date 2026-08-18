// Pure cryptographic binding for a release: one digest over the EXACT packaged
// artifact + its embedded attestation + the checksum manifest + the current
// commit AND its subject line. The acceptance report is derived from and bound to
// this digest, never from the current HEAD alone — so a report can only describe
// the specific bytes/attestation/commit it was cut against. A drift in any
// input (a rebuilt binary, an edited attestation, a re-worded commit, an amended
// checksum) changes the digest and the acceptance fails closed rather than
// silently over-writing evidence for a different artifact.

import { createHash } from 'node:crypto'
import canonicalJsonModule from '../../../electron/canonical-json.cjs'

/** Stable fingerprint of a commit: its full SHA folded with its subject line, so
 * a re-worded/amended commit at the same tree no longer matches an old binding. */
export function commitFingerprint(head, subject) {
  return createHash('sha256')
    .update(`${head || 'unknown'}\n${(subject || '').trim()}`)
    .digest('hex')
}

/**
 * Canonical, key-sorted JSON so the digest is independent of property order.
 *
 * RE-EXPORTED, not implemented here: the very same bytes are what an Ed25519
 * signature covers on BOTH sides of the trust story — the build-time release
 * ledger (gather.mjs `authenticateLedger`) and the runtime update manifest
 * (electron/update-manifest-verify.cjs `manifestSigningBody`). The runtime half
 * cannot import scripts/ (build.files ships `electron/**`, never `scripts/**`),
 * so the single implementation lives in electron/canonical-json.cjs and both
 * sides use that exact function. Byte-identity is thereby a fact of the module
 * graph rather than a property two copies must be tested into agreeing on.
 */
export const { canonicalJson } = canonicalJsonModule
const canonical = canonicalJson

/**
 * Compute the release binding.
 *   installers  : [{ name, bytes, sha256 }]  (the packaged binaries)
 *   attestation : the manifest embedded in release/win-unpacked/resources/
 *   checksums   : the release/checksums.json manifest
 *   head, subject : current commit + its subject line
 * Returns { digest, commit_fingerprint, parts } — `parts` are the redaction-safe
 * scalars the acceptance appendix prints; `digest` is the bound value.
 */
export function computeReleaseBinding({ installers = [], attestation = null, checksums = null, head, subject } = {}) {
  const commit_fingerprint = commitFingerprint(head, subject)
  const parts = {
    installers: [...installers]
      .map(e => ({ name: e.name, bytes: e.bytes, sha256: e.sha256 }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    attestation: attestation
      ? {
          app_version: attestation.app_version,
          source_head: attestation.source_head,
          source_fingerprint: attestation.source_fingerprint,
          artifact_kind: attestation.artifact_kind
        }
      : null,
    checksums: checksums ? { installers: checksums.installers } : null,
    commit_fingerprint
  }
  const digest = createHash('sha256').update(canonical(parts)).digest('hex')
  return { digest, commit_fingerprint, parts }
}
