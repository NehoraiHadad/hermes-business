// Reduce an E2E's raw JSON output to a small, redacted evidence envelope under
// docs/evidence/. Running the suites is done separately (with the right env and
// isolation); this step is a deterministic reduction so the persisted evidence
// contains only scalar booleans/counts/enums — never paths, logs or content.
// The per-category reducers live in scripts/lib/evidence-reducers.mjs.
//
// Usage:
//   node scripts/capture-evidence.mjs shared-state <raw.json>
//   node scripts/capture-evidence.mjs thin-installer <raw.json>
//   node scripts/capture-evidence.mjs approval <shared-state-raw.json> --blocked-live "<reason>"
//   node scripts/capture-evidence.mjs packaged-e2e --status blocked --reason "<reason>" --extra key=val,key=val

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { buildEnvelope, EVIDENCE_DIR } from './lib/evidence.mjs'
import {
  reduceSharedState,
  reduceIsolatedPackaged,
  reduceIsolatedApproval,
  reduceThinInstaller
} from './lib/evidence-reducers.mjs'

const bool = v => (v == null ? null : Boolean(v))

const [, , category, ...rest] = process.argv
const flags = {}
const positionals = []
for (let i = 0; i < rest.length; i += 1) {
  if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[i + 1]?.startsWith('--') || rest[i + 1] === undefined ? true : rest[++i]
  else positionals.push(rest[i])
}
const rawPath = positionals[0]
const raw = rawPath ? JSON.parse(readFileSync(rawPath, 'utf8')) : null
const nowIso = new Date().toISOString()

let envelope
if (category === 'shared-state') {
  envelope = buildEnvelope('shared-state', reduceSharedState(raw), { tool: 'e2e-hermes-shared-state.mjs', status: raw.ok ? 'passed' : 'blocked', capturedAt: nowIso })
} else if (category === 'thin-installer') {
  const summary = reduceThinInstaller(raw)
  envelope = buildEnvelope('thin-installer', summary, { tool: 'e2e-thin-network-installer.ps1', status: summary.all_cases_green ? 'passed' : 'blocked', capturedAt: nowIso })
} else if (category === 'approval') {
  // Prefer the real isolated-runtime denial probe when its raw is supplied; the
  // wiring facts (the companion wrapper delegates to the official approval.respond
  // with no competing engine) are code invariants asserted by the unit suite.
  const isoRaw = flags.isolated ? JSON.parse(readFileSync(flags.isolated, 'utf8')) : (raw?.approval ? raw : null)
  if (isoRaw) {
    const probe = reduceIsolatedApproval(isoRaw)
    const summary = {
      wiring: { official_method: 'approval.respond', competing_engine: false, delegates_to_official: true },
      unit_coverage: true,
      live_ui_denial_probe: probe
    }
    envelope = buildEnvelope('approval', summary, {
      tool: 'e2e-installed-isolated.mjs (real gateway approval.request/respond)',
      status: probe.status,
      capturedAt: nowIso
    })
  } else {
    const summary = {
      wiring: { official_method: raw?.approval_mapping?.official_method ?? null, competing_engine: bool(raw?.approval_mapping?.competing_engine), delegates_to_official: Boolean(raw?.approval_mapping?.wrapper_delegates_via) },
      unit_coverage: true,
      live_ui_denial_probe: { status: 'blocked', reason: flags['blocked-live'] || 'requires live Hermes profile; companion has no isolated-home support' }
    }
    envelope = buildEnvelope('approval', summary, { tool: 'e2e-hermes-shared-state.mjs + approval.mjs (gap)', status: 'blocked', capturedAt: nowIso })
  }
} else if (category === 'packaged-e2e') {
  // Real isolated packaged run when its raw (with isolation+teardown) is given;
  // otherwise the flag-driven blocked/manual fallback.
  if (raw && raw.isolation && raw.teardown) {
    const summary = reduceIsolatedPackaged(raw)
    envelope = buildEnvelope('packaged-e2e', summary, {
      tool: 'e2e-installed-isolated.mjs',
      status: raw.ok ? 'passed' : 'blocked',
      capturedAt: nowIso
    })
  } else {
    const extra = {}
    for (const pair of String(flags.extra || '').split(',').filter(Boolean)) {
      const [k, v] = pair.split('=')
      extra[k] = v === 'true' ? true : v === 'false' ? false : Number.isFinite(Number(v)) ? Number(v) : v
    }
    envelope = buildEnvelope('packaged-e2e', { reason: flags.reason || 'not run', ...extra }, { tool: 'e2e-installed-ui.mjs (gap)', status: flags.status || 'blocked', capturedAt: nowIso })
  }
} else {
  console.error(`Unknown category: ${category}`)
  process.exit(1)
}

mkdirSync(EVIDENCE_DIR, { recursive: true })
const out = path.join(EVIDENCE_DIR, `${category}.json`)
writeFileSync(out, `${JSON.stringify(envelope, null, 2)}\n`)
console.log(`Wrote ${path.relative(path.join(EVIDENCE_DIR, '..', '..'), out)} (status=${envelope.status})`)
