const fs = require('node:fs')
const path = require('node:path')

// Read the build attestation embedded in the packaged artifact.
//
// The prepare step (scripts/gen-build-attestation.mjs) writes the manifest and
// build.extraResources copies it to `<resources>/build-attestation.json`. In the
// running app that is `process.resourcesPath/build-attestation.json`. The harness
// verified the SAME file on disk before launch; exposing the nonce back here lets
// the isolated E2E prove the launched binary is exactly the attested one (a stale
// installed build carries a different nonce, or none at all).
//
// Fail-open to null: absent/unreadable/malformed manifest simply yields no
// attestation field. Never throws — production (unpackaged dev, or a build
// without the manifest) is unaffected.

const ATTESTATION_BASENAME = 'build-attestation.json'

function readEmbeddedAttestation() {
  try {
    const resources = process.resourcesPath
    if (!resources) return null
    const manifest = JSON.parse(fs.readFileSync(path.join(resources, ATTESTATION_BASENAME), 'utf8'))
    if (!manifest || typeof manifest !== 'object') return null
    return manifest
  } catch {
    return null
  }
}

/** Redaction-safe projection surfaced to the renderer bridge under QA mode. */
function qaAttestationSummary() {
  const manifest = readEmbeddedAttestation()
  if (!manifest) return null
  return {
    artifactKind: manifest.artifact_kind || null,
    appVersion: manifest.app_version || null,
    headShort: manifest.source_head_short || null,
    fingerprintPrefix:
      typeof manifest.source_fingerprint === 'string' ? manifest.source_fingerprint.slice(0, 16) : null,
    nonce: manifest.build_nonce || null
  }
}

module.exports = { readEmbeddedAttestation, qaAttestationSummary, ATTESTATION_BASENAME }
