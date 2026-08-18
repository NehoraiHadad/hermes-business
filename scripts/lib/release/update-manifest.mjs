// BUILD-TIME half of the update-manifest contract: build, sign, self-verify and
// cross-check the per-release signed statement that authenticates an installer.
//
// ── Where the VERIFIER lives, and why it is not here ─────────────────────────
// `verifyUpdateManifest` / `manifestSigningBody` / the schema+code constants are
// needed by the SHIPPED app, and `package.json` build.files packages `dist/**`,
// `electron/**`, `build/icon.png`, `hermes-plugin/**` and `package.json` —
// `scripts/**` is NOT packaged. Code that lives here is simply absent from
// app.asar at runtime, so the verification half now lives in
// electron/update-manifest-verify.cjs and is IMPORTED AND RE-EXPORTED below:
// exactly one implementation, reachable from both sides. The dependency
// direction is the only possible one (build-time may import runtime; the
// reverse cannot work) and is already established by
// electron/companion-update-core.cjs being imported by this tree.
//
// Doctrine (same as provenance.mjs HIGH 6): a self-applied label is never
// trusted. The build-time ledger (release-ledger.json + build/trust-roots.json)
// authenticates a release RETROSPECTIVELY — its `github_asset_sha256` map can
// only ever pin versions that already shipped, so an app binary built at
// v0.4.0-alpha.7 physically cannot contain the digest of the future
// v0.4.0-alpha.8 it is about to install. A runtime updater therefore needs a
// different shape of trust root: a STABLE public key compiled into the shipped
// app (electron/update-trust.cjs) plus a PER-RELEASE signed statement — this
// manifest — published alongside the installer.
//
// What the manifest buys us, given there is NO code-signing certificate and
// there will not be one: the installer bytes are unsigned, so Windows itself
// vouches for nothing. The ONLY thing standing between a user and an attacker-
// supplied .exe is this detached Ed25519 signature over the installer's digest.
// The signature must therefore be verified BEFORE the downloaded bytes are ever
// executed, and every field the updater acts on must be read out of the
// AUTHENTICATED document, never out of the (attacker-influenceable) HTTP
// response around it.
//
// This module is PURE — no fs, no net, no key material. The signature check is
// INJECTED (`verifySignature`), exactly like authenticateProvenance(), so every
// fail-closed branch is unit-testable without keys, and the real verifier
// (electron/update-trust.cjs) stays the only place a public key lives.

import { createHash } from 'node:crypto'
import { expectedInstallerName } from './artifact-set.mjs'
import manifestVerify from '../../../electron/update-manifest-verify.cjs'

// The runtime verifier, re-exported VERBATIM. Callers (finalize-release.mjs,
// update-signing.mjs, the tests) keep importing them from here; there is still
// only one implementation, and it is the one that actually ships.
export const {
  UPDATE_MANIFEST_SCHEMA,
  UPDATE_MANIFEST_CODES,
  manifestSigningBody,
  verifyUpdateManifest
} = manifestVerify

/**
 * Build the UNSIGNED manifest document. Only the fields below ever reach the
 * signed body — the installer record is rebuilt field-by-field rather than
 * spread, so a caller cannot smuggle an extra attribute into the signature (and,
 * worse, into some future schema's meaning).
 *
 *   version    : the version this manifest describes (package.json version)
 *   channel    : 'public' | 'qa' | 'pilot' — recorded, never inferred
 *   installer  : { name?, sha256, bytes } — name defaults to the ONE pinned
 *                artifact name (artifact-set.mjs), never a free-form string
 *   releasedAt : ISO date (YYYY-MM-DD)
 *   signedBy   : key id that will sign it (must exist in the shipped trust map)
 */
export function buildUpdateManifest({ version, channel, installer, releasedAt, signedBy } = {}) {
  if (!version || typeof version !== 'string') throw new TypeError('buildUpdateManifest: version is required')
  if (!channel || typeof channel !== 'string') throw new TypeError('buildUpdateManifest: channel is required')
  if (!signedBy || typeof signedBy !== 'string') throw new TypeError('buildUpdateManifest: signedBy (key id) is required')
  if (!releasedAt || typeof releasedAt !== 'string') throw new TypeError('buildUpdateManifest: releasedAt is required')
  if (!installer || typeof installer !== 'object') throw new TypeError('buildUpdateManifest: installer is required')
  return {
    schema: UPDATE_MANIFEST_SCHEMA,
    version,
    channel,
    installer: {
      name: installer.name || expectedInstallerName(null, version),
      sha256: installer.sha256,
      bytes: installer.bytes
    },
    released_at: releasedAt,
    signed_by: signedBy
  }
}

/** Attach a detached signature to an unsigned document (no mutation). */
export function attachSignature(doc, signatureB64) {
  return { ...doc, signature: signatureB64 }
}

/**
 * Stable, content-derived key id for an Ed25519 public key (SPKI DER bytes).
 * Deriving the id FROM the key means a rotated key can never accidentally reuse
 * an old id: "which key signed this" is answered by the key bytes, not by a
 * human-typed label that can be copied onto different material.
 */
export function keyIdFromPublicKeyDer(der) {
  return `tachles-update-ed25519-${createHash('sha256').update(der).digest('hex').slice(0, 16)}`
}

/**
 * Build + sign + SELF-VERIFY in one pure step (crypto injected).
 *   doc             : an unsigned document from buildUpdateManifest()
 *   sign            : (body:string) => base64 signature string
 *   verifySignature : (body, sig, keyId) => boolean — the SHIPPED verifier
 *   keys            : the SHIPPED trust map, so we prove the app can verify it
 *
 * A signing step that can emit a manifest the shipped app cannot verify is worse
 * than no signing step at all — it would look like a trust anchor and be one only
 * on paper. So the freshly signed document is round-tripped through the very same
 * verifyUpdateManifest() the runtime uses, with the SHIPPED public keys, before it
 * is returned. `currentVersion` is a synthetic floor ('0.0.0'): the self-check is
 * about signature + shape, not about whatever happens to be installed on the
 * release operator's own machine.
 */
/**
 * Cross-check an authenticated manifest's installer digest against the OTHER two
 * independent records of the same bytes: release/checksums.json (measured from
 * disk by the packaging pipeline) and, once the release is published, the
 * never-shrinking release-ledger.json entry for that version.
 *
 * These are three separately-produced statements about one file. Agreement is
 * cheap; DISAGREEMENT means the manifest is signing a digest that is not the
 * artifact this release actually cut — a mixed-up build, a stale manifest left in
 * release/, or a substituted binary. There is no benign reading of it, so it is a
 * hard failure rather than a warning. A ledger with no entry for this version yet
 * (the normal case at finalize time — the entry is added AFTER publishing) is
 * simply not a data point, never an implicit pass of a mismatch.
 *
 * Returns { ok, code?, detail, compared:string[] } — `compared` names the records
 * that actually contributed, so "agreed with nothing" is visible rather than
 * indistinguishable from "agreed with everything".
 */
export function crossCheckInstallerDigest({ manifest, checksums = null, ledger = null } = {}) {
  const compared = []
  const name = manifest?.installer?.name
  const digest = manifest?.installer?.sha256
  const bytes = manifest?.installer?.bytes
  if (!name || !digest) return { ok: false, code: 'installer-absent', detail: 'manifest has no installer record to cross-check', compared }

  const entry = Array.isArray(checksums?.installers) ? checksums.installers.find(e => e && e.name === name) : null
  if (checksums) {
    if (!entry) return { ok: false, code: 'checksums-entry-absent', detail: `checksums.json has no entry for ${name}`, compared }
    if (entry.sha256 !== digest) {
      return { ok: false, code: 'checksums-digest-mismatch', detail: `manifest installer.sha256 ${digest} != checksums.json ${entry.sha256} for ${name}`, compared }
    }
    if (Number.isInteger(entry.bytes) && entry.bytes !== bytes) {
      return { ok: false, code: 'checksums-bytes-mismatch', detail: `manifest installer.bytes ${bytes} != checksums.json ${entry.bytes} for ${name}`, compared }
    }
    compared.push('checksums.json')
  }

  const ledgerEntry = ledger?.entries?.[manifest.version]
  if (ledgerEntry) {
    if (ledgerEntry.sha256 !== digest) {
      return { ok: false, code: 'ledger-digest-mismatch', detail: `manifest installer.sha256 ${digest} != release-ledger.json ${ledgerEntry.sha256} for v${manifest.version}`, compared }
    }
    compared.push('release-ledger.json')
  }
  return { ok: true, detail: compared.length ? `installer digest agrees with ${compared.join(' + ')}` : 'no independent digest record to compare against', compared }
}

export function signUpdateManifest({ doc, sign, verifySignature, keys, currentVersion = '0.0.0' } = {}) {
  if (typeof sign !== 'function') throw new TypeError('signUpdateManifest: sign(body) is required')
  const body = manifestSigningBody(doc)
  const manifest = attachSignature(doc, sign(body))
  const check = verifyUpdateManifest({ manifest, currentVersion, expectedVersion: doc.version, keys, verifySignature })
  if (!check.ok) return { ok: false, manifest: null, code: check.code, detail: `refusing to emit an unverifiable manifest: ${check.detail}` }
  return { ok: true, manifest, code: null, detail: check.detail }
}
