// The SHIPPED trust root for the in-app one-click updater.
//
// Tachles ships an UNSIGNED NSIS installer — there is no code-signing
// certificate and there will not be one (docs/RELEASING.md, docs/specs/
// versioning.md §13). Windows therefore vouches for nothing: to a machine, the
// installer we published and an installer an attacker handed it are the same
// kind of anonymous .exe. The only thing that can tell them apart is a detached
// signature made by a key the app already trusts BEFORE it went looking for an
// update — that key is here.
//
// Why a .cjs source module and not a .json data file: `electron/**` is already
// inside build.files (so this file ships verbatim inside app.asar) and already
// inside the subject registry's APP_RUNTIME_INPUTS walk (so editing it correctly
// invalidates a prepared artifact and shows up as a dirty release input). A new
// .json would need packaging-contract and registry churn to gain exactly the same
// properties. Source, not data, also means the verifier lives next to the key it
// verifies with, and nothing can "load a trust map from disk" at runtime.
//
// Nothing secret is in this file. The private half never leaves the release
// operator's machine (scripts/gen-update-key.mjs writes it OUTSIDE the repo).

const { verify: cryptoVerify } = require('node:crypto')

/**
 * Trusted update-signing public keys, by key id.
 *
 * A MAP, not a single key, on purpose: key rotation must never be a flag day.
 * Every already-installed app only trusts the keys compiled into the build the
 * user happens to be running, and we cannot update all of them at once. So a new
 * key is added ALONGSIDE the old one; releases keep being signed with the old key
 * until enough installs carry a build that also knows the new id, then signing
 * switches over and the old entry is retired in a later build. With a single-key
 * constant, rotating would instantly strand every older install with no verifiable
 * update path — i.e. exactly the outage a compromised key would force on us.
 *
 * Key ids are DERIVED from the key bytes (see keyIdFromPublicKeyDer in
 * scripts/lib/release/update-manifest.mjs), so an id can never be reused for
 * different material.
 */
const UPDATE_TRUST_KEYS = Object.freeze({
  // PRIMARY (active signer). Generated 2026-08-18.
  // Private half: %USERPROFILE%\.tachles-release\update-signing-key.pem
  'tachles-update-ed25519-947e2bb83d384c67': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAYD+OjPzYJc4EcU5dZlx8gF1Y04GYzaHKuPpt4OVPXfs=
-----END PUBLIC KEY-----
`,
  // RESERVE (never signs a routine release). Generated 2026-08-18 alongside the
  // primary, and shipped from this build onward for ONE reason: rotation only
  // ever helps FUTURE installs. An app already on a user's disk trusts exactly
  // the ids compiled into it, and we cannot reach it to add one — so if the
  // primary key is lost or compromised AFTER a build ships, a brand-new key is
  // worthless to that install and every user would have to reinstall by hand.
  // Provisioning the reserve NOW, before there is a user base, is the only
  // moment it can be done cheaply.
  //
  // What this does and does not buy, stated plainly: it protects against LOSS
  // unconditionally. It protects against COMPROMISE only to the extent the two
  // private halves live in different places — the reserve is meant to be moved
  // offline and deleted from the build machine, and if it is left sitting next
  // to the primary then a single machine compromise takes both and the reserve
  // has bought nothing. There is deliberately no revocation channel: adding the
  // reserve lets us sign again, it cannot make installed apps STOP trusting a
  // stolen primary (see docs/specs/versioning.md §7.3).
  'tachles-update-ed25519-c6379a37ef1fb417': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA5YNR4qOMt9uiv9cC96KbiutqyHvajZ0oVuX/NvvLpaU=
-----END PUBLIC KEY-----
`
})

/**
 * Verify a detached Ed25519 signature over the canonical manifest body.
 *
 * `crypto.verify(null, ...)` — a null digest algorithm — is the Ed25519
 * convention already used by the build-time ledger verifier (scripts/lib/release/
 * gather.mjs makeLedgerVerifier); both sides of the trust story therefore use the
 * SAME primitive and the same base64 encoding, so a body that verifies in one
 * place cannot mysteriously fail in the other.
 *
 * Returns a strict boolean. An unknown key id, an absent signature, malformed
 * base64 or any thrown crypto error all mean "not verified" — never an exception
 * that a caller could accidentally catch into a pass.
 *
 * @param {string} body        the canonical signing body (manifestSigningBody)
 * @param {string} signatureB64 base64 detached signature
 * @param {string} keyId       which trusted key is claimed to have signed it
 */
function verifyManifestSignature(body, signatureB64, keyId) {
  const pem = Object.prototype.hasOwnProperty.call(UPDATE_TRUST_KEYS, keyId) ? UPDATE_TRUST_KEYS[keyId] : null
  if (!pem || typeof body !== 'string' || !signatureB64) return false
  try {
    return cryptoVerify(null, Buffer.from(body, 'utf8'), pem, Buffer.from(String(signatureB64), 'base64')) === true
  } catch {
    return false
  }
}

module.exports = { UPDATE_TRUST_KEYS, verifyManifestSignature }
