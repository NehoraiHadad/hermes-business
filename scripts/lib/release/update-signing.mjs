// Impure half of the runtime update trust anchor: locate the operator's private
// key, sign the manifest, and decide — fail-closed — what release/ may carry.
//
// The pure decision logic lives in update-manifest.mjs; everything that touches
// the filesystem or real key material is here, and it is deliberately inside
// scripts/lib/release/ so the subject registry's declarative `{ dir:
// 'scripts/lib/release' }` walk fingerprints it automatically — a change to HOW a
// release is signed must invalidate a prepared artifact exactly like a change to
// how it is verified, with no registry edit (and no SUBJECT_SCHEME churn) needed.

import { createPublicKey, createPrivateKey, sign as cryptoSign } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildUpdateManifest,
  crossCheckInstallerDigest,
  keyIdFromPublicKeyDer,
  signUpdateManifest,
  verifyUpdateManifest
} from './update-manifest.mjs'
import { expectedInstallerName } from './artifact-set.mjs'
import updateTrust from '../../../electron/update-trust.cjs'

const { UPDATE_TRUST_KEYS, verifyManifestSignature } = updateTrust

/** The sidecar name, used by both the signer CLI and the finalize transaction. */
export const UPDATE_MANIFEST_FILE = 'update-manifest.json'

/** Env var that points at the private key on a build machine. */
export const SIGNING_KEY_ENV = 'TACHLES_UPDATE_SIGNING_KEY'

/** Default private-key location: OUTSIDE the repo, in the operator's profile. */
export function defaultSigningKeyPath(home = os.homedir()) {
  return path.join(home, '.tachles-release', 'update-signing-key.pem')
}

/**
 * Where the private key is (or why we have none). Precedence: an explicit
 * --key, then the env var, then the default profile path. Never searches the
 * repository — a signing key inside the working tree is a mistake we refuse to
 * make convenient.
 * Returns { path, source } or { path: null, source: null, reason }.
 */
export function resolveSigningKey({ explicitPath = null, env = process.env, home = os.homedir(), exists = existsSync } = {}) {
  // An EXPLICIT key is exclusive: if the operator named a key, a missing one is an
  // error, never a quiet fallback to some other key on the machine.
  if (explicitPath) {
    const p = path.resolve(explicitPath)
    return exists(p) ? { path: p, source: '--key' } : { path: null, source: null, reason: `named signing key does not exist: ${p}` }
  }
  const candidates = [
    env?.[SIGNING_KEY_ENV] ? { path: path.resolve(env[SIGNING_KEY_ENV]), source: SIGNING_KEY_ENV } : null,
    { path: defaultSigningKeyPath(home), source: 'default profile path' }
  ].filter(Boolean)
  for (const c of candidates) if (exists(c.path)) return c
  return { path: null, source: null, reason: `no update signing key (looked at ${candidates.map(c => c.path).join(', ')})` }
}

/** Load a PKCS#8 Ed25519 private key and derive its content-addressed key id. */
export function loadSigningKey(keyPath) {
  const pem = readFileSync(keyPath, 'utf8')
  const privateKey = createPrivateKey(pem)
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(`signing key at ${keyPath} is ${privateKey.asymmetricKeyType || 'of unknown type'}, expected ed25519`)
  }
  const der = createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
  return { privateKey, keyId: keyIdFromPublicKeyDer(der) }
}

/** Pull the one installer record for `version` out of a checksums.json manifest. */
function installerFromChecksums(checksums, version) {
  const name = expectedInstallerName(null, version)
  const entry = Array.isArray(checksums?.installers) ? checksums.installers.find(e => e && e.name === name) : null
  return entry ? { name: entry.name, sha256: entry.sha256, bytes: entry.bytes } : null
}

/**
 * Sign a manifest for `version` with the key at `keyPath`, self-verifying against
 * the SHIPPED public keys before returning anything (see signUpdateManifest).
 * Returns { ok, manifest, keyId, code?, detail }.
 */
export function produceSignedManifest({ version, channel, checksums, releasedAt = todayIso(), keyPath }) {
  const installer = installerFromChecksums(checksums, version)
  if (!installer) {
    return { ok: false, manifest: null, keyId: null, code: 'checksums-entry-absent', detail: `checksums.json has no entry for ${expectedInstallerName(null, version)}` }
  }
  const { privateKey, keyId } = loadSigningKey(keyPath)
  // The key that signs MUST be one the shipped app already trusts. Signing with a
  // key that is not in electron/update-trust.cjs would produce a perfectly valid
  // signature nobody can check — a trust anchor in name only.
  if (!Object.prototype.hasOwnProperty.call(UPDATE_TRUST_KEYS, keyId)) {
    return {
      ok: false,
      manifest: null,
      keyId,
      code: 'signer-unknown',
      detail: `key ${keyId} at ${keyPath} is NOT in electron/update-trust.cjs — the shipped app could not verify what it signs. ` +
        'Paste its public key into UPDATE_TRUST_KEYS (scripts/gen-update-key.mjs prints the snippet) and rebuild.'
    }
  }
  const doc = buildUpdateManifest({ version, channel, installer, releasedAt, signedBy: keyId })
  const signed = signUpdateManifest({
    doc,
    sign: body => cryptoSign(null, Buffer.from(body, 'utf8'), privateKey).toString('base64'),
    verifySignature: verifyManifestSignature,
    keys: UPDATE_TRUST_KEYS
  })
  return { ...signed, keyId }
}

/**
 * Decide what release/update-manifest.json may contain for this build. Called by
 * finalize-release.mjs INSIDE the all-or-nothing sidecar transaction.
 *
 * Four outcomes, all explicit:
 *   'signed'  — a key was available; a fresh, self-verified manifest was produced.
 *   'reused'  — no key on this machine, but release/ already holds a manifest that
 *               VERIFIES against the shipped public keys for exactly this version
 *               (e.g. it was signed on the release operator's box and the build was
 *               re-finalized here). Its exact bytes are re-staged, unmodified.
 *   'absent'  — no key and no manifest. The release ships WITHOUT an update trust
 *               anchor. Never "present and unsigned": a placeholder would teach the
 *               updater to accept unsigned statements, which is the whole attack.
 *   'invalid' — a HARD failure: a signing attempt that could not self-verify, a
 *               stale/forged manifest sitting in release/, or a digest that
 *               disagrees with checksums.json / release-ledger.json.
 *
 * Returns { status, json?, manifest?, keyId?, code?, detail }.
 */
export function prepareUpdateManifest({
  root,
  version,
  channel,
  checksums,
  ledger = null,
  explicitKeyPath = null,
  releasedAt = todayIso(),
  env = process.env
}) {
  const releaseDir = path.join(root, 'release')
  const existingPath = path.join(releaseDir, UPDATE_MANIFEST_FILE)
  const key = resolveSigningKey({ explicitPath: explicitKeyPath, env })

  if (key.path) {
    let signed
    try {
      signed = produceSignedManifest({ version, channel, checksums, releasedAt, keyPath: key.path })
    } catch (e) {
      return { status: 'invalid', code: 'signing-failed', detail: `update manifest signing failed with the key at ${key.path}: ${e.message}` }
    }
    if (!signed.ok) return { status: 'invalid', code: signed.code, detail: signed.detail }
    const cross = crossCheckInstallerDigest({ manifest: signed.manifest, checksums, ledger })
    if (!cross.ok) return { status: 'invalid', code: cross.code, detail: cross.detail }
    return {
      status: 'signed',
      json: `${JSON.stringify(signed.manifest, null, 2)}\n`,
      manifest: signed.manifest,
      keyId: signed.keyId,
      detail: `signed by ${signed.keyId} (${key.source}); ${cross.detail}`
    }
  }

  if (!existsSync(existingPath)) {
    return { status: 'absent', code: 'no-signing-key', detail: key.reason }
  }

  // A manifest already sits in release/ but we hold no key. We can still CHECK it
  // — the public keys ship in this very repo — and we must: leaving an unverified
  // (possibly stale, possibly from another version) manifest to be uploaded next
  // to a fresh installer is precisely the downgrade material this design exists to
  // deny. Verify or refuse; never pass through.
  let parsed
  const bytes = readFileSync(existingPath)
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch (e) {
    return { status: 'invalid', code: 'manifest-unparseable', detail: `release/${UPDATE_MANIFEST_FILE} is not valid JSON (${e.message}) — remove it or re-sign it` }
  }
  const verdict = verifyUpdateManifest({
    manifest: parsed,
    // Synthetic floor: the "is it newer than what is installed" question is the
    // RUNTIME's, not the release machine's. Here we are only proving the manifest
    // is authentic and describes THIS build.
    currentVersion: '0.0.0',
    expectedVersion: version,
    keys: UPDATE_TRUST_KEYS,
    verifySignature: verifyManifestSignature
  })
  if (!verdict.ok) {
    return { status: 'invalid', code: verdict.code, detail: `existing release/${UPDATE_MANIFEST_FILE} does not verify: ${verdict.detail}` }
  }
  const cross = crossCheckInstallerDigest({ manifest: parsed, checksums, ledger })
  if (!cross.ok) return { status: 'invalid', code: cross.code, detail: cross.detail }
  return {
    status: 'reused',
    json: bytes,
    manifest: parsed,
    keyId: parsed.signed_by,
    detail: `re-staged the existing manifest signed by ${parsed.signed_by}; ${cross.detail}`
  }
}

/** UTC calendar date (YYYY-MM-DD) — the same shape release-ledger.json records. */
export function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10)
}
