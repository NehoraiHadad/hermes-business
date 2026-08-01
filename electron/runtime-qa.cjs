const { getQaNamespaceRecord } = require('./qa-diagnostics.cjs')
const { qaAttestationSummary } = require('./qa-attestation.cjs')

/**
 * Assemble the executable QA proof surface folded into runtimeState.qa under the
 * qa-isolated contract: the Electron namespace record (applied synchronously
 * before the single-instance lock) plus the embedded build attestation. Lets the
 * isolated E2E prove — from the live binary — that the fix ran and that this is
 * the freshly attested win-unpacked artifact.
 */
function buildQaDiagnostics() {
  const ns = getQaNamespaceRecord()
  return {
    namespaceApplied: Boolean(ns.namespaceApplied && ns.appliedBeforeLock),
    appliedBeforeLock: Boolean(ns.appliedBeforeLock),
    userDataIsolated: Boolean(ns.isolated),
    attestation: qaAttestationSummary()
  }
}

module.exports = { buildQaDiagnostics }
