// ARTIFACT ATTESTATION GATE for the isolated packaged E2E (fail BEFORE launch).
//
// Deterministically targets ONLY release/win-unpacked of the current working
// tree — there is no installed-app fallback and no HERMES_BUSINESS_EXE escape
// hatch, so a stale installed build (the incident's root cause) can never be
// selected. The embedded manifest must correspond to the source checked out NOW;
// otherwise the caller refuses to launch and prints a redacted reason (relative
// path + hash prefix only).

import path from 'node:path'
import { resolvePackagedArtifact, verifyArtifactCurrent } from '../build-attestation.mjs'

/**
 * Resolve + attest the one launchable artifact. Never launches, never exits;
 * returns a redaction-safe verdict for the orchestrator to act on:
 *   { ok, artifact:{...}, error? , executablePath?, appDirectory?, artifactKind?, expectedNonce? }
 * Throws only if the prepared artifact is entirely absent (resolvePackagedArtifact).
 */
export function resolveAttestedArtifact({ root }) {
  const resolved = resolvePackagedArtifact({ root })
  const attest = verifyArtifactCurrent({ dir: resolved.unpackedDir, root })
  const artifact = {
    kind: attest.manifest?.artifact_kind ?? null,
    path_rel: path.relative(root, resolved.executablePath).split(path.sep).join('/'),
    head_short: attest.manifest?.source_head_short ?? null,
    fingerprint_prefix: attest.currentFingerprintPrefix ?? null,
    reasons: attest.reasons
  }
  if (!attest.ok) {
    return { ok: false, artifact, error: `artifact not attested to current source: ${attest.reasons.join(', ')}` }
  }
  return {
    ok: true,
    artifact,
    executablePath: resolved.executablePath,
    appDirectory: resolved.appDirectory,
    artifactKind: attest.manifest.artifact_kind,
    expectedNonce: attest.manifest.build_nonce
  }
}
