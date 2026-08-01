// Verifier for docs/evidence/*.json. Proves, for every evidence file:
//   1. Schema — required envelope keys, known category/status, redacted flag.
//   2. Redaction — no secret/email/absolute-path shapes survive anywhere in the
//      envelope, and the stored summary equals its own re-redaction (idempotent).
//   3. Correspondence — app_version + hermes_range match the current tree, and
//      git_head relates to HEAD in a way its git_state permits: a committed
//      envelope survives only on HEAD itself or after an evidence-only refresh
//      commit; a working-tree envelope's head need only be a real, reachable
//      base. Bogus/stale/non-ancestor heads fail closed (see git-provenance.mjs).
//   4. Anti-false-pass — a `passed` envelope must carry the concrete proof
//      booleans for its category (see evidence-gates.mjs).
//
// The rules live in ./lib/evidence-gates.mjs; this file is the thin loop + CLI.
// Exported as verifyEvidence() for the unit test; also runnable as a CLI
// (`npm run verify:evidence`) that exits non-zero on any failure.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { EVIDENCE_DIR, ROOT_DIR, appVersion, hermesRange, gitInfo } from './lib/evidence.mjs'
import { verifyEnvelope } from './lib/evidence-gates.mjs'

export function verifyEvidence({ dir = EVIDENCE_DIR } = {}) {
  const errors = []
  // cwd anchors the provenance git calls (merge-base/diff) at the repo root.
  const current = { app: appVersion(), range: hermesRange(), cwd: ROOT_DIR, ...gitInfo() }
  if (!existsSync(dir)) return { ok: false, files: [], errors: [`evidence dir missing: ${dir}`] }

  const files = readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'schema.json')
  if (files.length === 0) errors.push('no evidence files found')

  for (const file of files) {
    let env
    try {
      env = JSON.parse(readFileSync(path.join(dir, file), 'utf8'))
    } catch (e) {
      errors.push(`${file}: invalid JSON (${e.message})`)
      continue
    }
    // Defense in depth: the gates are fail-closed, but any unexpected throw
    // (e.g. a git subprocess error) becomes a per-file error, never a crash that
    // would silently abort verification of the remaining envelopes.
    try {
      verifyEnvelope(env, current, msg => errors.push(`${file}: ${msg}`))
    } catch (e) {
      errors.push(`${file}: verification error (${e.message})`)
    }
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
