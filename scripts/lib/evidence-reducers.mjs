// Pure reducers that shrink an E2E's raw JSON output to a small, redacted evidence
// summary: scalar booleans/counts/enums only — never paths, logs or content. Kept
// separate from the capture-evidence.mjs CLI so the reduction is unit-testable.
import { machineCaptureBinding } from './release/evidence-capture.mjs'
const bool = v => (v == null ? null : Boolean(v))
const sumCounts = obj => Object.values(obj || {}).reduce((a, b) => a + (Number(b) || 0), 0)
// A job appearing in the operator's live profile is a protected mutation. (The
// cron DIRECTORY's own churn is the ticker's, and is disclosed as volatile.)
const cronJobAdds = td => Math.max(0, (Number(td?.live_cron_jobs_after) || 0) - (Number(td?.live_cron_jobs_before) || 0))
const present = (obj, omit = []) =>
  Object.fromEntries(
    Object.entries(obj || {})
      .filter(([k]) => !omit.includes(k))
      .map(([k, v]) => [k, Boolean(v)])
  )
export function reduceSharedState(r) {
  const p = r.plugin_shared_state || {}
  return {
    ok: bool(r.ok),
    health: bool(r.health),
    provider_free: bool(r.live_transport?.skipped),
    live_home_untouched: Boolean(r.one_runtime?.live_home_untouched),
    session_shared: { via_rest: bool(r.session_shared_state?.visible_via_rest), via_rpc: bool(r.session_shared_state?.visible_via_rpc_list) },
    cron_shared: present({ via_rpc: r.cron_shared_state?.visible_via_rpc, on_disk: r.cron_shared_state?.visible_on_disk, removed: r.cron_shared_state?.removed }),
    skill_shared: { via_rpc: bool(r.skill_shared_state?.visible_via_rpc), skill_count: r.skill_shared_state?.skill_count ?? null },
    path_evidence: { under_isolated_home: bool(r.path_evidence?.under_isolated_home), present: present(r.path_evidence?.present) },
    plugin: {
      installed: bool(p.discovery?.business_shell_present),
      integrity_verified: bool(p.discovery?.integrity_verified),
      status: p.inventory?.status ?? null,
      enabled: bool(p.inventory?.enabled),
      contributions_count: Array.isArray(p.contributions) ? p.contributions.length : null,
      route_provider_free: bool(p.route_render?.provider_free),
      shared_state: present(p.shared_state, ['skill_count']),
      uninstall: present(p.uninstall)
    },
    approval_mapping: { official_method: r.approval_mapping?.official_method ?? null, competing_engine: bool(r.approval_mapping?.competing_engine) }
  }
}

// Reduce the isolated packaged E2E (scripts/e2e-installed-isolated.mjs) raw
// output to scalar booleans. Both the packaged-e2e and approval envelopes draw
// from this single real run.
export function reduceIsolatedPackaged(r) {
  const iso = r.isolation || {}
  const td = r.teardown || {}
  // HIGH 3: machine-capture the build binding from the exact staged artifact the
  // isolated run launched (nonce echoed by the running app + measured hashes). Any
  // gap leaves the binding fields absent so the release gate fails closed rather
  // than accepting a hand-entered binding.
  const cap = machineCaptureBinding(r)
  return {
    ...(cap.binding || {}),
    capture_ok: cap.ok,
    ran: true,
    artifact_attested: bool(r.artifact_attested),
    artifact_kind: r.artifact_kind ?? null,
    qa_namespace_applied: bool(r.qa_namespace_applied),
    isolated_runtime: iso.runtime_mode === 'qa-isolated',
    ws_on_isolated_port: bool(iso.ws_on_isolated_port),
    isolated_session_count: iso.isolated_session_count ?? null,
    isolated_home_populated: bool(iso.isolated_home_populated),
    live_home_untouched: bool(td.live_home_untouched),
    live_config_unchanged: bool(td.live_config_unchanged),
    // The operator's own scheduled jobs: identical definitions before and after,
    // and readable on both sides. Reports predating the field skip the term.
    live_cron_jobs_unchanged: 'live_cron_jobs_unchanged' in td ? bool(td.live_cron_jobs_unchanged) : null,
    // Stable marker equality: config + cron JOB DEFINITIONS + RECURSIVE content
    // fingerprints of the durable trees; a nested edit or same-size byte rewrite
    // flips it. Equal to live_home_untouched by construction.
    live_marker_stable_equal: bool(td.live_marker_exact_equal),
    // Structural (path add/remove/type-change) vs content (same-path byte rewrite)
    // drift, kept separate; both 0 on a real pass. Counts only — never names/paths.
    live_structural_additions: sumCounts(td.live_stable_structural_changed) + cronJobAdds(td),
    live_content_rewrites: sumCounts(td.live_stable_content_changed),
    live_unsafe_entries: Number(td.live_stable_unsafe_entries) || 0,
    live_volatile_runtime_changes: sumCounts(td.live_volatile_runtime_changes),
    temp_home_removed: bool(td.temp_home_removed),
    isolated_port_free: bool(td.isolated_port_free),
    // Owned-tree containment: on Windows the run positively verifies every
    // process identity it spawned is dead (a detached gateway is residue even
    // when the temp home came off). Reports predating the field skip the term.
    owned_tree_dead: td.owned_tracking_applicable ? bool(td.owned_tree_dead) : null,
    no_residual:
      bool(td.temp_home_removed) &&
      bool(td.isolated_port_free) &&
      bool(td.probe_file_absent) &&
      (td.owned_tracking_applicable ? bool(td.owned_tree_dead) : true)
  }
}

export function reduceIsolatedApproval(r) {
  const a = r.approval || {}
  const requested = bool(a.requested)
  const denied = bool(a.denied)
  const noSideEffect = bool(a.no_side_effect)
  return {
    status: requested && denied && noSideEffect ? 'passed' : 'blocked',
    artifact_attested: bool(r.artifact_attested),
    qa_namespace_applied: bool(r.qa_namespace_applied),
    isolated_runtime: r.isolation?.runtime_mode === 'qa-isolated',
    via_real_event_path: bool(a.via_real_event_path),
    official_method: a.official_method || 'approval.respond',
    requested,
    request_command_present: bool(a.request_command_present),
    denied,
    deny_resolved_count: a.deny_resolved_count ?? null,
    no_side_effect: noSideEffect,
    renderer_modal_faked: bool(a.renderer_modal_faked)
  }
}

export function reduceThinInstaller(r) {
  const cases = r.cases && typeof r.cases === 'object' ? r.cases : {}
  // qaArtifact is emitted alongside the case results but is not itself a test case.
  const caseEntries = Object.entries(cases)
    .filter(([k, v]) => k !== 'qaArtifact' && v && typeof v === 'object')
    .map(([, v]) => v)
  const passed = caseEntries.filter(c => c.ok === true || c.pass === true || c.passed === true).length
  return {
    ok: bool(r.ok),
    isolated: bool(r.isolated),
    cases_total: caseEntries.length,
    cases_passed: passed,
    all_cases_green: caseEntries.length > 0 && passed === caseEntries.length
  }
}
