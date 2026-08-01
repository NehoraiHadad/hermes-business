// AUTOMATED EXACT-ARTIFACT E2E CAPTURE — the pure orchestration decision.
//
// The lifecycle this closes: the packaged-e2e evidence binding used to be typed in by
// hand (`capture-evidence --extra build_nonce=…`). The only trustworthy binding is one
// a single automated lifecycle MEASURES: fingerprint the IMMUTABLE candidate package
// (installer sha + release-binding digest + attestation nonce), launch/test the EXACT
// installed candidate in isolation, capture the build_nonce the RUNNING app echoes,
// require it non-empty AND equal to the candidate nonce, then machine-write evidence.
//
// This module owns the decision (pure, unit-tested with synthetic runs); the script
// (scripts/e2e-exact-artifact.mjs) does the I/O — measure, launch, pipe to capture.

import { machineCaptureBinding, BINDING_FIELDS } from './evidence-capture.mjs'

export { BINDING_FIELDS }

export function selectVersionedInstaller(names = [], version = '') {
  const matches = names.filter(name =>
    name.toLowerCase().endsWith('.exe') &&
    name.includes(version) &&
    !name.startsWith('Hermes-Business-Web-Setup-')
  )
  return matches.length === 1
    ? { ok: true, name: matches[0], errors: [] }
    : { ok: false, name: null, errors: [`expected exactly one companion installer for ${version}; found ${matches.length}`] }
}

/**
 * Assemble the immutable-candidate measurement from disk facts (all measured, none
 * hand-entered). `installer_sha256` from the packaged installer bytes, `build_nonce`
 * from the embedded attestation, `release_binding_digest` from the staged report.
 * Returns { ok, errors, candidate }.
 */
export function measureCandidate({ installerSha256, buildNonce, releaseBindingDigest } = {}) {
  const errors = []
  if (!installerSha256) errors.push('candidate installer sha256 missing (no packaged installer)')
  if (!buildNonce) errors.push('candidate build_nonce missing (no embedded attestation)')
  if (!releaseBindingDigest) errors.push('candidate release_binding_digest missing (run gen-release-report first)')
  return {
    ok: errors.length === 0,
    errors,
    candidate: { installer_sha256: installerSha256 || null, build_nonce: buildNonce || null, release_binding_digest: releaseBindingDigest || null }
  }
}

/**
 * Assemble the evidence-shaped raw the capture step reduces: the isolated-harness
 * report PLUS the machine-measured build binding. capture_method is 'machine' by
 * construction — there is no manual path here.
 */
export function assembleExactArtifactRaw({ harnessReport = {}, candidate = {} } = {}) {
  return {
    ...harnessReport,
    exact_staged_artifact: harnessReport.exact_staged_artifact === true,
    running_nonce: harnessReport.running_nonce || null,
    build_binding: {
      build_nonce: candidate.build_nonce || null,
      release_binding_digest: candidate.release_binding_digest || null,
      installer_sha256: candidate.installer_sha256 || null
    }
  }
}

/**
 * The whole-lifecycle verdict. Fails on: missing candidate measurement, a run that
 * did not pass, a run that did not launch the EXACT staged artifact, an ABSENT
 * running nonce, or a running nonce that DISAGREES with the candidate. On success the
 * raw carries a machine-captured binding (capture_method:'machine'); it is never
 * reachable via a hand-entered value.
 * Returns { ok, errors, raw, binding }.
 */
export function assessExactArtifactRun({ candidate = {}, harnessReport = null } = {}) {
  const errors = []
  if (!candidate.installer_sha256 || !candidate.build_nonce || !candidate.release_binding_digest) {
    errors.push('immutable candidate not fully measured')
  }
  if (!harnessReport) errors.push('no isolated-run report')
  if (harnessReport && harnessReport.ok !== true) errors.push('isolated run did not pass')
  if (harnessReport && harnessReport.exact_staged_artifact !== true) errors.push('run did not launch the exact immutable staged artifact')
  const running = harnessReport?.running_nonce || null
  if (!running) errors.push('running app echoed NO build_nonce (nonce absent)')
  else if (candidate.build_nonce && running !== candidate.build_nonce) errors.push('running-app nonce disagrees with candidate build_nonce (wrong binary launched)')

  const raw = assembleExactArtifactRaw({ harnessReport: harnessReport || {}, candidate })
  // machineCaptureBinding is the authoritative binding gate (also checks nonce equality).
  const cap = machineCaptureBinding(raw)
  return {
    ok: errors.length === 0 && cap.ok,
    errors: [...new Set([...errors, ...cap.errors])],
    raw,
    binding: cap.binding
  }
}
