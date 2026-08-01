// Executable QA diagnostics surfaced by the RUNNING packaged app.
//
// The isolated E2E must prove — from the live binary, not by inspecting source —
// two things the incident hinged on:
//   1. the QA Electron userData/sessionData namespace was repartitioned
//      SYNCHRONOUSLY, BEFORE app.requestSingleInstanceLock(); and
//   2. the launched binary is the freshly attested win-unpacked artifact (its
//      embedded build nonce matches the manifest the harness verified pre-launch).
//
// main.cjs records (1) here the instant it sets the paths — so the flag can only
// be true in a binary that actually contains the fix. runtime.cjs folds this plus
// the embedded attestation (see qa-attestation.cjs) into the QA runtime state the
// renderer bridge returns. Production never reads it (no QA sentinel → the runtime
// leaves runtimeState.qa null).

let record = {
  namespaceApplied: false,
  appliedBeforeLock: false,
  isolated: false,
  userDataLeaf: null
}

/**
 * Called by main.cjs immediately after app.setPath('userData'/'sessionData', …)
 * and strictly BEFORE requestSingleInstanceLock(). `appliedBeforeLock` is the
 * literal proof that this code path executed in the running binary ahead of the
 * lock.
 */
function recordQaNamespaceApplied(info) {
  record = { ...record, ...info }
}

function getQaNamespaceRecord() {
  return record
}

module.exports = { recordQaNamespaceApplied, getQaNamespaceRecord }
