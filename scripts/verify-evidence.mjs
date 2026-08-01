// Verifier for docs/evidence/*.json. Proves, for every evidence file:
//   1. Schema — required envelope keys, known category/status, redacted flag.
//   2. Redaction — no secret/email/absolute-path shapes survive anywhere in the
//      envelope, and the stored summary equals its own re-redaction (idempotent).
//   3. Correspondence — app_version + hermes_range match the current tree, and
//      the git commit matches HEAD unless the envelope clearly says working-tree
//      (the pre-commit case).
//
// Exported as verifyEvidence() for the unit test; also runnable as a CLI
// (`npm run verify:evidence`) that exits non-zero on any failure.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import {
  EVIDENCE_DIR, SCHEMA_VERSION, appVersion, hermesRange, gitInfo, redactDeep
} from './lib/evidence.mjs'

const CATEGORIES = new Set(['packaged-e2e', 'thin-installer', 'shared-state', 'approval'])
const STATUSES = new Set(['passed', 'blocked', 'skipped'])
const REQUIRED = [
  'schema_version', 'category', 'status', 'app_version', 'hermes_range',
  'git_head', 'git_state', 'redacted', 'summary'
]

// Leak detectors run over the fully-serialized envelope.
const LEAK_PATTERNS = [
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
const PASS_PROOF = {
  'packaged-e2e': [
    'artifact_attested',
    'qa_namespace_applied',
    'isolated_runtime',
    'ws_on_isolated_port',
    'isolated_home_populated',
    'live_home_untouched',
    'live_config_unchanged',
    'no_residual'
  ],
  approval: [
    'live_ui_denial_probe.artifact_attested',
    'live_ui_denial_probe.qa_namespace_applied',
    'live_ui_denial_probe.isolated_runtime',
    'live_ui_denial_probe.via_real_event_path',
    'live_ui_denial_probe.requested',
    'live_ui_denial_probe.denied',
    'live_ui_denial_probe.no_side_effect',
    'wiring.delegates_to_official'
  ],
  'shared-state': ['ok'],
  'thin-installer': ['all_cases_green']
}

function dig(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

function requirePassProof(env, fail) {
  const keys = PASS_PROOF[env.category] || []
  for (const key of keys) {
    if (dig(env.summary, key) !== true) {
      fail(`status=passed but proof "${key}" is not true (got ${JSON.stringify(dig(env.summary, key))})`)
    }
  }
  // packaged-e2e must additionally prove a clean isolated session count of 0 and
  // that the attested artifact was the current-source win-unpacked build.
  if (env.category === 'packaged-e2e' && env.summary?.isolated_session_count !== 0) {
    fail(`status=passed but isolated_session_count is ${JSON.stringify(env.summary?.isolated_session_count)} (must be 0)`)
  }
  if (env.category === 'packaged-e2e' && env.summary?.artifact_kind !== 'win-unpacked-current') {
    fail(`status=passed but artifact_kind is ${JSON.stringify(env.summary?.artifact_kind)} (must be win-unpacked-current)`)
  }
  // A denial probe that "passed" must never be a faked renderer modal.
  if (env.category === 'approval' && env.summary?.live_ui_denial_probe?.renderer_modal_faked !== false) {
    fail('status=passed approval but renderer_modal_faked is not false')
  }
}

export function verifyEvidence({ dir = EVIDENCE_DIR } = {}) {
  const errors = []
  const current = { app: appVersion(), range: hermesRange(), ...gitInfo() }
  if (!existsSync(dir)) return { ok: false, files: [], errors: [`evidence dir missing: ${dir}`] }

  const files = readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'schema.json')
  if (files.length === 0) errors.push('no evidence files found')

  for (const file of files) {
    const full = path.join(dir, file)
    let env
    try {
      env = JSON.parse(readFileSync(full, 'utf8'))
    } catch (e) {
      errors.push(`${file}: invalid JSON (${e.message})`)
      continue
    }
    const fail = msg => errors.push(`${file}: ${msg}`)

    for (const key of REQUIRED) if (!(key in env)) fail(`missing required key "${key}"`)
    if (env.schema_version !== SCHEMA_VERSION) fail(`schema_version ${env.schema_version} != ${SCHEMA_VERSION}`)
    if (!CATEGORIES.has(env.category)) fail(`unknown category "${env.category}"`)
    if (!STATUSES.has(env.status)) fail(`unknown status "${env.status}"`)
    if (env.redacted !== true) fail('redacted flag must be true')
    if (typeof env.summary !== 'object' || env.summary === null) fail('summary must be an object')

    // Redaction: idempotent re-redaction must be a no-op.
    if (JSON.stringify(redactDeep(env.summary)) !== JSON.stringify(env.summary)) {
      fail('summary is not fully redacted (re-redaction changed it)')
    }
    const serialized = JSON.stringify(env)
    for (const [pattern, label] of LEAK_PATTERNS) {
      if (pattern.test(serialized)) fail(`possible ${label} leak`)
    }

    // Correspondence to the current tree.
    if (env.app_version !== current.app) fail(`app_version ${env.app_version} != current ${current.app}`)
    if (env.hermes_range !== current.range) fail(`hermes_range ${env.hermes_range} != current ${current.range}`)
    if (!['committed', 'working-tree'].includes(env.git_state)) fail(`invalid git_state "${env.git_state}"`)
    if (env.git_state === 'committed' && env.git_head !== current.git_head) {
      fail(`git_head ${env.git_head?.slice(0, 12)} != HEAD ${current.git_head.slice(0, 12)} (and not marked working-tree)`)
    }

    // Anti-false-pass: a `passed` envelope MUST carry the concrete proof booleans
    // for its category. This makes it impossible to flip a status to passed
    // without the real, reduced evidence behind it.
    if (env.status === 'passed') requirePassProof(env, fail)
  }

  return { ok: errors.length === 0, files, errors }
}

// CLI entry (only when run directly, not when imported by the test).
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('verify-evidence.mjs')) {
  const result = verifyEvidence()
  if (result.ok) {
    console.log(`evidence OK — ${result.files.length} file(s) verified: ${result.files.join(', ')}`)
  } else {
    console.error(`evidence verification FAILED:\n - ${result.errors.join('\n - ')}`)
    process.exit(1)
  }
}
