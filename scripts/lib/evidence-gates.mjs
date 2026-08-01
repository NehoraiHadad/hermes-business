// Evidence verification gates: the schema, redaction, correspondence and
// anti-false-pass rules that every envelope under docs/evidence must satisfy.
// Kept separate from the verify-evidence CLI so the rules are cohesive and
// independently testable, and so the CLI stays a thin orchestrator.

import { SCHEMA_VERSION, redactDeep } from './evidence.mjs'

export const CATEGORIES = new Set(['packaged-e2e', 'thin-installer', 'shared-state', 'approval', 'telegram'])
export const STATUSES = new Set(['passed', 'blocked', 'skipped'])
export const REQUIRED = [
  'schema_version', 'category', 'status', 'app_version', 'hermes_range',
  'git_head', 'git_state', 'redacted', 'summary'
]

// Leak detectors run over the fully-serialized envelope.
export const LEAK_PATTERNS = [
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, 'email address'],
  [/\bsk-[A-Za-z0-9_-]{12,}\b/, 'OpenAI key'],
  [/\bAIza[A-Za-z0-9_-]{20,}\b/, 'Google key'],
  [/\b\d{7,}:[A-Za-z0-9_-]{20,}\b/, 'Telegram bot token'],
  [/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]{8,}=*/, 'Authorization header'],
  [/[A-Za-z]:\\Users\\[^\s"']+/i, 'absolute Windows user path'],
  [/\/(?:Users|home)\/[A-Za-z0-9._-]+/, 'absolute POSIX user path']
]

// Every proof key listed here MUST be strictly === true in a `passed` envelope's
// summary (nested via dotted paths). Absent/false/non-true → the pass is rejected.
export const PASS_PROOF = {
  'packaged-e2e': [
    'artifact_attested', 'qa_namespace_applied', 'isolated_runtime',
    'ws_on_isolated_port', 'isolated_home_populated', 'live_home_untouched',
    'live_config_unchanged', 'no_residual'
  ],
  approval: [
    'live_ui_denial_probe.artifact_attested', 'live_ui_denial_probe.qa_namespace_applied',
    'live_ui_denial_probe.isolated_runtime', 'live_ui_denial_probe.via_real_event_path',
    'live_ui_denial_probe.requested', 'live_ui_denial_probe.denied',
    'live_ui_denial_probe.no_side_effect', 'wiring.delegates_to_official'
  ],
  'shared-state': ['ok'],
  'thin-installer': ['all_cases_green'],
  // A live Telegram round-trip pass must prove: a valid bot owned solely by this
  // gateway (polling, no webhook), that inbound updates actually reached Hermes,
  // and that ONE authorized reply was delivered as a self-identified test.
  telegram: [
    'diagnosis.bot_token_valid', 'diagnosis.sole_poller_owner',
    'diagnosis.inbound_reached_hermes', 'roundtrip.outbound_delivered',
    'roundtrip.identifies_as_connectivity_test', 'fix.whatsapp_untouched',
    'fix.google_untouched'
  ]
}

function dig(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

export function checkSchema(env, fail) {
  for (const key of REQUIRED) if (!(key in env)) fail(`missing required key "${key}"`)
  if (env.schema_version !== SCHEMA_VERSION) fail(`schema_version ${env.schema_version} != ${SCHEMA_VERSION}`)
  if (!CATEGORIES.has(env.category)) fail(`unknown category "${env.category}"`)
  if (!STATUSES.has(env.status)) fail(`unknown status "${env.status}"`)
  if (env.redacted !== true) fail('redacted flag must be true')
  if (typeof env.summary !== 'object' || env.summary === null) fail('summary must be an object')
}

// Redaction: idempotent re-redaction must be a no-op, and no leak pattern may
// survive anywhere in the serialized envelope.
export function checkRedaction(env, fail) {
  if (JSON.stringify(redactDeep(env.summary)) !== JSON.stringify(env.summary)) {
    fail('summary is not fully redacted (re-redaction changed it)')
  }
  const serialized = JSON.stringify(env)
  for (const [pattern, label] of LEAK_PATTERNS) {
    if (pattern.test(serialized)) fail(`possible ${label} leak`)
  }
}

// Correspondence to the current tree: app/Hermes versions must match, and a
// committed envelope's git_head must equal HEAD (working-tree envelopes are the
// pre-commit case and are exempt).
export function checkCorrespondence(env, current, fail) {
  if (env.app_version !== current.app) fail(`app_version ${env.app_version} != current ${current.app}`)
  if (env.hermes_range !== current.range) fail(`hermes_range ${env.hermes_range} != current ${current.range}`)
  if (!['committed', 'working-tree'].includes(env.git_state)) fail(`invalid git_state "${env.git_state}"`)
  if (env.git_state === 'committed' && env.git_head !== current.git_head) {
    fail(`git_head ${env.git_head?.slice(0, 12)} != HEAD ${current.git_head.slice(0, 12)} (and not marked working-tree)`)
  }
}

// Anti-false-pass: a `passed` envelope MUST carry the concrete proof booleans for
// its category. This makes it impossible to flip a status to passed without the
// real, reduced evidence behind it.
export function requirePassProof(env, fail) {
  for (const key of PASS_PROOF[env.category] || []) {
    if (dig(env.summary, key) !== true) {
      fail(`status=passed but proof "${key}" is not true (got ${JSON.stringify(dig(env.summary, key))})`)
    }
  }
  const s = env.summary || {}
  if (env.category === 'packaged-e2e') {
    // Clean isolated session count of 0, attested to the current-source build.
    if (s.isolated_session_count !== 0) {
      fail(`status=passed but isolated_session_count is ${JSON.stringify(s.isolated_session_count)} (must be 0)`)
    }
    if (s.artifact_kind !== 'win-unpacked-current') {
      fail(`status=passed but artifact_kind is ${JSON.stringify(s.artifact_kind)} (must be win-unpacked-current)`)
    }
  }
  // A denial probe that "passed" must never be a faked renderer modal.
  if (env.category === 'approval' && s.live_ui_denial_probe?.renderer_modal_faked !== false) {
    fail('status=passed approval but renderer_modal_faked is not false')
  }
  // A telegram pass must be single-owner, mutation-free, and confined to the one
  // authorized chat — asserted as concrete negatives so a pass can never hide a
  // webhook/poller conflict, a config edit, or a stray extra send.
  if (env.category === 'telegram') {
    if (s.diagnosis?.webhook_present !== false) fail('status=passed telegram but webhook_present is not false')
    if (s.diagnosis?.external_owner_conflict !== false) fail('status=passed telegram but external_owner_conflict is not false')
    if (s.fix?.config_mutated !== false) fail('status=passed telegram but config_mutated is not false')
    if (s.fix?.env_mutated !== false) fail('status=passed telegram but env_mutated is not false')
    if (s.roundtrip?.other_chats_touched !== 0) {
      fail(`status=passed telegram but other_chats_touched is ${JSON.stringify(s.roundtrip?.other_chats_touched)} (must be 0)`)
    }
  }
}

// Run every gate against one envelope, funneling failures through `fail`.
export function verifyEnvelope(env, current, fail) {
  checkSchema(env, fail)
  checkRedaction(env, fail)
  checkCorrespondence(env, current, fail)
  if (env.status === 'passed') requirePassProof(env, fail)
}
