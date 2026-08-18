// Shared test fixtures for the evidence verifier suites: scratch-dir management,
// an envelope writer, and the canonical "fully passing" summaries each gate test
// mutates one field at a time. Not a *.test file, so vitest never runs it alone.

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDirs = []

// Create a throwaway evidence directory; call cleanupScratch() from afterAll.
export function scratchDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'evidence-test-'))
  tmpDirs.push(dir)
  return dir
}

export function cleanupScratch() {
  tmpDirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true }))
}

export function writeEnvelope(dir, name, env) {
  writeFileSync(path.join(dir, name), JSON.stringify(env, null, 2))
}

// A packaged-e2e summary with every proof boolean set true. The build-binding
// triple (finding 4) ties the evidence to the exact tested artifact: the
// build_nonce the running app echoes, the release report's binding digest, and the
// installer sha256. The release preflight also VALUE-matches these to the artifact.
export const passingPackaged = () => ({
  ran: true,
  artifact_attested: true,
  artifact_kind: 'win-unpacked-current',
  build_nonce: 'n'.repeat(32),
  release_binding_digest: 'r'.repeat(64),
  installer_sha256: 's'.repeat(64),
  qa_namespace_applied: true,
  isolated_runtime: true,
  ws_on_isolated_port: true,
  isolated_session_count: 0,
  isolated_home_populated: true,
  live_home_untouched: true,
  live_config_unchanged: true,
  live_cron_jobs_unchanged: true,
  live_marker_stable_equal: true,
  live_structural_additions: 0,
  live_content_rewrites: 0,
  live_unsafe_entries: 0,
  no_residual: true
})

// An approval summary whose live denial probe traversed the real event path.
export const passingApproval = () => ({
  wiring: { official_method: 'approval.respond', competing_engine: false, delegates_to_official: true },
  unit_coverage: true,
  live_ui_denial_probe: {
    status: 'passed',
    artifact_attested: true,
    qa_namespace_applied: true,
    isolated_runtime: true,
    via_real_event_path: true,
    requested: true,
    denied: true,
    no_side_effect: true,
    renderer_modal_faked: false
  }
})
