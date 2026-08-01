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

// A packaged-e2e summary with every proof boolean set true.
export const passingPackaged = () => ({
  ran: true,
  artifact_attested: true,
  artifact_kind: 'win-unpacked-current',
  qa_namespace_applied: true,
  isolated_runtime: true,
  ws_on_isolated_port: true,
  isolated_session_count: 0,
  isolated_home_populated: true,
  live_home_untouched: true,
  live_config_unchanged: true,
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

// A raw live Telegram round-trip probe result (pre-reduction).
export const passingTelegram = () => ({
  diagnosis: {
    connection_mode: 'polling', webhook_present: false, sole_poller_owner: true,
    external_owner_conflict: false, bot_token_valid: true, is_bot: true,
    inbound_reached_hermes: true, prior_no_reply_cause: 'sender_not_authorized_at_prior_send_time',
    allowlist_now_authorizes_sender: true, pending_update_count: 0
  },
  fix: {
    method: 'no_mutation_needed', config_mutated: false, env_mutated: false,
    whatsapp_untouched: true, google_untouched: true, gateway_restarted: false, gateway_alive: true
  },
  roundtrip: {
    outbound_delivered: true, target_home_channel: true, other_chats_touched: 0,
    official_mechanism: 'hermes_send_cli', agent_originated_inbound: false,
    inbound_historically_processed: true, inbound_path_ready: true, identifies_as_connectivity_test: true
  },
  runtime_state: 'connected', gateway_running: true
})
