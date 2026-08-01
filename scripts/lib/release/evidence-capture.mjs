// HIGH 3 — the packaged-e2e build binding must be MACHINE-captured from the exact
// staged artifact, never hand-entered.
//
// The lifecycle hole: the packaged-e2e envelope's build_nonce / release_binding_digest
// / installer_sha256 were supplied through capture-evidence's `--extra key=val`
// manual path. A human (or a script) could type any three values and the evidence
// would "bind" to a build that was never tested. The only trustworthy binding is one
// the harness MEASURES: the nonce the running isolated app echoed, the binding
// digest recomputed over the immutable staged artifact, and the installer hash taken
// from those exact bytes. This module derives that binding from the raw run and
// refuses any hand-entered substitute.

export const BINDING_FIELDS = ['build_nonce', 'release_binding_digest', 'installer_sha256']

/**
 * Machine-derive the build binding from an isolated-run raw result.
 *   raw.exact_staged_artifact : true iff the run launched the EXACT immutable staged
 *                               artifact (not a rebuilt/looser copy).
 *   raw.running_nonce         : the build_nonce the RUNNING app echoed back.
 *   raw.build_binding         : { build_nonce, release_binding_digest, installer_sha256 }
 *                               measured by the harness from the artifact on disk.
 * Returns { ok, errors, binding } — binding carries capture_method:'machine' and is
 * null on any gap, so a passed envelope can never be minted without a real capture.
 */
export function machineCaptureBinding(raw = {}) {
  const b = raw.build_binding || {}
  const errors = []
  if (raw.exact_staged_artifact !== true) errors.push('run did not test the exact immutable staged artifact')
  for (const f of BINDING_FIELDS) if (!b[f]) errors.push(`machine capture missing ${f}`)
  // The running nonce must be NON-EMPTY (the app actually echoed its identity) AND
  // equal to the measured artifact nonce. An absent nonce is a capture failure, not
  // a pass — otherwise a binding could be minted for an app that never proved itself.
  if (!raw.running_nonce) errors.push('running app echoed no build_nonce (nonce absent)')
  else if (b.build_nonce && b.build_nonce !== raw.running_nonce) {
    errors.push('running-app nonce disagrees with the measured artifact nonce (wrong binary launched)')
  }
  const ok = errors.length === 0
  return {
    ok,
    errors,
    binding: ok
      ? { build_nonce: b.build_nonce, release_binding_digest: b.release_binding_digest, installer_sha256: b.installer_sha256, capture_method: 'machine' }
      : null
  }
}

/** Refuse a hand-entered binding: the manual `--extra build_nonce=…` path or any
 * capture_method that is not 'machine'. Returns [{code,detail}] failures. */
export function assertMachineCaptured(summary = {}) {
  const errors = []
  if (summary.capture_method !== 'machine') {
    errors.push({ code: 'evidence-manual-binding', detail: `packaged-e2e build binding capture_method=${JSON.stringify(summary.capture_method)} — must be machine-captured from the staged artifact, not hand-entered` })
  }
  if (summary.manual_entry) {
    errors.push({ code: 'evidence-manual-binding', detail: 'packaged-e2e binding carries a manual_entry marker (rejected)' })
  }
  return errors
}

/** True iff a CLI passed one of the binding fields as a manual `--extra` override —
 * the capture tool uses this to REFUSE minting a machine binding by hand. */
export function hasManualBindingOverride(extraKeys = []) {
  return extraKeys.some(k => BINDING_FIELDS.includes(k) || k === 'capture_method')
}
