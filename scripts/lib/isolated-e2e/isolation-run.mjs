// Isolation assessment + the two fail-fast gates for the isolated packaged E2E,
// lifted out of the thin orchestrator. Every check here runs BEFORE any session
// create / prompt / credential seed / approval, and mutates the shared `report`
// so the caller's finally block still tears down and preserves a forensic report.

import { evaluateIsolationPreconditions } from '../isolated-runtime.mjs'
import {
  assessRuntimeIsolation,
  isolatedHomePopulated,
  queryIsolatedSessionCount
} from './isolation-probe.mjs'

/**
 * Assess runtime isolation, run the STRUCTURAL gate (never query a gateway that
 * is not proven isolated) and then the AUTHORITATIVE precondition gate (all four
 * invariants: qa-isolated mode, isolated WS port, diagnostics home == temp home,
 * ZERO baseline sessions). Mutates `report`; throws on any failure. Returns the
 * assess result for the caller's final verdict.
 */
export async function assessAndGateIsolation({
  page,
  runtime,
  isolatedPort,
  tempHome,
  expectedNonce,
  liveMarkerBefore,
  report
}) {
  const assess = assessRuntimeIsolation({
    runtime,
    isolatedPort,
    tempHome,
    expectedNonce,
    liveSessionCountBefore: liveMarkerBefore.inventory.sessions
  })
  report.qa_namespace_applied = assess.qaNamespaceApplied
  report.artifact.running_nonce_matches = assess.nonceMatch
  report.artifact.qa_namespace_applied = assess.qaNamespacePresent
  report.isolation = assess.isolation

  // STRUCTURAL GATE — evaluated BEFORE we open a socket to ANY gateway. If the
  // runtime is not in qa-isolated mode on OUR isolated port with the throwaway
  // temp home, we must NOT query it (that would count the live gateway's
  // sessions) and must NOT proceed to seed/prompt/approve.
  if (
    assess.runtimeMode !== 'qa-isolated' ||
    !assess.wsOnIsolatedPort ||
    !report.isolation.diagnostics_home_is_temp ||
    !report.qa_namespace_applied
  ) {
    report.isolation.aborted_precondition = true
    throw new Error(
      `isolation preconditions failed before any query/approval: mode=${assess.runtimeMode} ` +
        `ws_on_isolated_port=${assess.wsOnIsolatedPort} diagnostics_home_is_temp=${report.isolation.diagnostics_home_is_temp} ` +
        `qa_namespace_applied=${report.qa_namespace_applied}`
    )
  }

  // Proven isolated: only NOW count sessions over the isolated gateway URL.
  const isolatedSessionCount = await queryIsolatedSessionCount(page)
  report.isolation.isolated_session_count = isolatedSessionCount
  report.isolation.isolated_home_populated = isolatedHomePopulated(tempHome)

  // AUTHORITATIVE FAIL-FAST GATE — the tested invariant set.
  const preconditions = evaluateIsolationPreconditions({
    runtimeMode: assess.runtimeMode,
    wsPort: assess.wsPort,
    isolatedPort,
    diagnosticsHome: assess.diagnosticsHome,
    tempHome,
    isolatedSessionCount
  })
  report.isolation.preconditions = preconditions.checks
  if (!preconditions.ok) {
    report.isolation.aborted_precondition = true
    throw new Error(`isolation preconditions failed: ${preconditions.failed.join(', ')}`)
  }
  return assess
}

/** Final ok verdict from the (mutated) report: isolation AND approval both clean. */
export function computeRunVerdict({ report, runApproval }) {
  const isolationOk =
    report.artifact_attested === true &&
    report.qa_namespace_applied === true &&
    report.isolation.runtime_mode === 'qa-isolated' &&
    report.isolation.ws_on_isolated_port === true &&
    report.isolation.isolated_home_populated === true &&
    report.isolation.isolated_session_count === 0
  const approvalOk =
    !runApproval || (report.approval.requested && report.approval.denied && report.approval.no_side_effect)
  return isolationOk && approvalOk
}
