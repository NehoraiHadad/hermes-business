// The RUNTIME verifier for the signed update manifest — the ONLY thing standing
// between a user and an attacker-supplied .exe.
//
// ── Why this file is under electron/ and not scripts/lib/release/ ────────────
// It was originally written in scripts/lib/release/update-manifest.mjs. That is
// a PACKAGING DEFECT, not a style choice: `package.json` build.files ships
// `dist/**`, `electron/**`, `build/icon.png`, `hermes-plugin/**` and
// `package.json` — `scripts/**` is NOT packaged, so at runtime (inside
// app.asar) nothing under scripts/ exists at all. A verifier the shipped app
// cannot load is a trust anchor on paper only. The pure, runtime-needed half
// therefore lives HERE, and scripts/lib/release/update-manifest.mjs imports and
// RE-EXPORTS it so there is exactly ONE implementation — build-time code may
// import runtime code, and the reverse is physically impossible.
// Build-only concerns (buildUpdateManifest, attachSignature, signUpdateManifest,
// keyIdFromPublicKeyDer, crossCheckInstallerDigest) stay in scripts/.
//
// ── Doctrine (unchanged from the original module) ────────────────────────────
// A self-applied label is never trusted. The build-time ledger authenticates a
// release RETROSPECTIVELY — its `github_asset_sha256` map can only ever pin
// versions that already shipped, so an app built at v0.4.0-alpha.7 physically
// cannot contain the digest of the future v0.4.0-alpha.8 it is about to install.
// A runtime updater therefore needs a different shape of trust root: a STABLE
// public key compiled into the shipped app (electron/update-trust.cjs) plus a
// PER-RELEASE signed statement — this manifest — published alongside the
// installer.
//
// What the manifest buys us, given there is NO code-signing certificate and
// there will not be one: the installer bytes are unsigned, so Windows itself
// vouches for nothing. The signature must be verified BEFORE the downloaded
// bytes are ever executed, and every field the updater acts on must be read out
// of the AUTHENTICATED document, never out of the (attacker-influenceable) HTTP
// response around it.
//
// This module is PURE — no fs, no net, no key material. The signature check is
// INJECTED (`verifySignature`), so every fail-closed branch is unit-testable
// without keys, and the real verifier (electron/update-trust.cjs) stays the only
// place a public key lives.

const { canonicalJson } = require('./canonical-json.cjs')
const { expectedInstallerName } = require('./update-artifact-name.cjs')
const { parseSemver, compareSemver } = require('./companion-update-core.cjs')

// SemVer is NOT reimplemented here. The companion update CHECK already owns the
// one strict, fully-tested SemVer 2.0.0 implementation (docs/specs/versioning.md
// §6.1); a second copy could order two versions differently from the check that
// selected them, and that seam is exactly where a downgrade attack lives.

/** The only manifest schema this build understands. An unknown schema is a
 * REFUSAL, never a best-effort parse: a future field could change the meaning of
 * a field we do understand (say, a `revoked` or `min_version` semantics we would
 * silently ignore). Fail closed and let the user install by hand. */
const UPDATE_MANIFEST_SCHEMA = 1

/** Every fail-closed verdict this module can return. Exported so callers (and
 * tests) branch on a stable code instead of matching prose. */
const UPDATE_MANIFEST_CODES = Object.freeze([
  'manifest-absent',
  'schema-unsupported',
  'expected-version-absent',
  'direction-unknown',
  'signer-unknown',
  'signature-absent',
  'signature-invalid',
  'version-mismatch',
  'version-unparseable',
  'version-not-newer',
  'version-not-older',
  'installer-absent',
  'installer-digest-malformed',
  'installer-bytes-invalid',
  'installer-name-mismatch'
])

/**
 * Which way this install is allowed to move. This is a CALLER-declared intent,
 * never something read out of the manifest or off the network — a document does
 * not get to tell us whether it is an upgrade.
 *
 *   'forward'  — the ordinary update: the manifest must be STRICTLY NEWER than
 *                what is installed.
 *   'rollback' — the deliberate, separately-consented return to the version this
 *                install came from: the manifest must be STRICTLY OLDER.
 *
 * The anti-replay control is UNCHANGED in both directions, and that is the whole
 * reason a rollback is safe to allow: `expectedVersion` must still match the
 * manifest exactly, and for a rollback that value is derived from OUR OWN durable
 * journal (the version we recorded updating away from), not from the renderer and
 * not from the release feed. So an attacker cannot pick the destination — the
 * most they could do is replay the exact version the user already ran.
 */
const UPDATE_DIRECTIONS = Object.freeze(['forward', 'rollback'])

// Lowercase ONLY — one canonical spelling, so a manifest digest can never differ
// from the checksums.json entry by case alone (a difference the cross-check in
// finalize-release.mjs would then have to normalize away, i.e. weaken).
const SHA256_HEX = /^[0-9a-f]{64}$/

/**
 * The EXACT string the signature covers. Identical convention to the build-time
 * ledger (gather.mjs `authenticateLedger`): key-sorted canonical JSON of the whole
 * document with `signature` blanked out, so signer and verifier can never
 * disagree about property order or about whether the signature covers itself.
 * `canonicalJson` is the SAME function both sides use (electron/canonical-json.cjs,
 * re-exported by scripts/lib/release/binding.mjs) — see the note there on why a
 * mirrored copy would be a bug rather than a duplication.
 */
function manifestSigningBody(doc) {
  return canonicalJson({ ...doc, signature: undefined })
}

/**
 * Fail-closed verification of a signed update manifest.
 *
 *   manifest        : the parsed update-manifest.json (UNTRUSTED input)
 *   currentVersion  : the version currently INSTALLED
 *   expectedVersion : the version the update CHECK decided to install
 *   direction       : 'forward' (default) | 'rollback' — see UPDATE_DIRECTIONS
 *   keys            : trusted key map { keyId: PEM } (an array of ids also works)
 *   verifySignature : injected (body, signatureB64, keyId) => boolean
 *
 * Returns { ok, code?, detail }. Order matters: the document is AUTHENTICATED
 * first and only then are its claims (version, digest, name) examined — we never
 * make a decision based on a field of an unauthenticated document.
 */
function verifyUpdateManifest({ manifest, currentVersion, expectedVersion, direction = 'forward', keys, verifySignature } = {}) {
  if (!manifest || typeof manifest !== 'object') return fail('manifest-absent', 'no update manifest supplied')
  if (manifest.schema !== UPDATE_MANIFEST_SCHEMA) {
    return fail('schema-unsupported', `manifest schema ${JSON.stringify(manifest.schema)} != ${UPDATE_MANIFEST_SCHEMA} — this build cannot interpret it`)
  }
  // The caller MUST state what it expects. Without an expected version there is no
  // anti-replay control at all, so an absent one is a refusal, never a wildcard.
  if (!expectedVersion || typeof expectedVersion !== 'string') {
    return fail('expected-version-absent', 'no expectedVersion supplied — refusing to verify a manifest against "whatever it says"')
  }
  // A caller-side programming error, guarded like hostile input anyway: a typo
  // ('backward', 'rollBack') must not silently fall through to whichever branch
  // an `if/else` happens to leave open. There is no default-on-unknown.
  if (!UPDATE_DIRECTIONS.includes(direction)) {
    return fail('direction-unknown', `direction ${JSON.stringify(direction)} is not one of ${UPDATE_DIRECTIONS.join('/')} — refusing to guess which way this install may move`)
  }

  const trusted = Array.isArray(keys) ? keys : Object.keys(keys || {})
  const keyId = manifest.signed_by
  if (!keyId || !trusted.includes(keyId)) {
    return fail('signer-unknown', `signer ${keyId ? JSON.stringify(keyId) : '(absent)'} is not a trusted update key shipped in this build`)
  }
  if (!manifest.signature || typeof manifest.signature !== 'string') {
    return fail('signature-absent', 'manifest carries no signature — an unsigned manifest is treated as ABSENT, never as trusted')
  }
  const body = manifestSigningBody(manifest)
  if (typeof verifySignature !== 'function' || !verifySignature(body, manifest.signature, keyId)) {
    return fail('signature-invalid', `manifest signature does not verify against trusted key ${keyId} (forged/tampered)`)
  }

  // ---- authenticated from here down ----------------------------------------

  // ANTI-REPLAY — the control this whole artifact exists for. A signature proves
  // WHO wrote a statement, never WHEN it is being replayed. Anyone who can
  // influence the response (a hostile mirror, a MITM on a plain-HTTP hop, a
  // compromised release page) can serve a GENUINELY SIGNED OLD manifest plus its
  // matching old installer and force a downgrade onto a version with an
  // already-patched hole. Binding the manifest to the version the CHECK decided
  // on closes that: an old manifest is authentic but off-topic, and off-topic is
  // rejected.
  if (manifest.version !== expectedVersion) {
    return fail('version-mismatch', `manifest describes v${manifest.version} but the update check decided to install v${expectedVersion} (replayed/substituted manifest)`)
  }

  // Defence in depth: even if the CHECK itself were tricked into "deciding" on
  // the wrong version, the manifest must still lie on the side of the installed
  // version that the DECLARED direction allows. Unparseable on either side means
  // "cannot prove an order" → refuse (compareSemver returns null, which is never
  // treated as equality). Note `cmp === 0` fails in BOTH directions: reinstalling
  // the running version is not a move, and allowing it would give an attacker a
  // free "make them run the installer again" primitive.
  const cmp = compareSemver(manifest.version, currentVersion)
  const installedLabel = parseSemver(currentVersion)?.raw ?? currentVersion
  if (cmp === null) {
    return fail('version-unparseable', `cannot order manifest v${manifest.version} against installed ${currentVersion ? `v${currentVersion}` : '(absent)'} — refusing to guess`)
  }
  if (direction === 'forward' && cmp <= 0) {
    return fail('version-not-newer', `manifest v${manifest.version} is not strictly newer than the installed v${installedLabel} (rollback)`)
  }
  if (direction === 'rollback' && cmp >= 0) {
    return fail('version-not-older', `manifest v${manifest.version} is not strictly older than the installed v${installedLabel} — a rollback may only move backwards`)
  }

  const installer = manifest.installer
  if (!installer || typeof installer !== 'object') return fail('installer-absent', 'manifest carries no installer record')
  if (typeof installer.sha256 !== 'string' || !SHA256_HEX.test(installer.sha256)) {
    return fail('installer-digest-malformed', `installer.sha256 must be exactly 64 lowercase hex characters, got ${JSON.stringify(installer.sha256)}`)
  }
  if (!Number.isInteger(installer.bytes) || installer.bytes <= 0) {
    return fail('installer-bytes-invalid', `installer.bytes must be a positive integer, got ${JSON.stringify(installer.bytes)}`)
  }
  // The artifact name is PINNED by the release contract (update-artifact-name.cjs,
  // re-exported by scripts/lib/release/artifact-set.mjs) and DERIVED here, never
  // duplicated as a literal, so the runtime updater and the release gate can never
  // drift apart about which file is "the installer".
  const expectedName = expectedInstallerName(null, manifest.version)
  if (installer.name !== expectedName) {
    return fail('installer-name-mismatch', `installer.name ${JSON.stringify(installer.name)} != the pinned artifact name ${JSON.stringify(expectedName)}`)
  }

  return { ok: true, detail: `manifest for v${manifest.version} authenticated by ${keyId}` }
}

function fail(code, detail) { return { ok: false, code, detail } }

module.exports = {
  UPDATE_MANIFEST_SCHEMA,
  UPDATE_MANIFEST_CODES,
  UPDATE_DIRECTIONS,
  SHA256_HEX,
  manifestSigningBody,
  verifyUpdateManifest
}
