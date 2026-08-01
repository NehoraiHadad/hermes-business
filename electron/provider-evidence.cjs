const fs = require('node:fs')
const path = require('node:path')
const { hermesHome } = require('./paths.cjs')
const { safeWrite } = require('./atomic-write.cjs')

// Durable, NON-SECRET provider validation evidence.
//
// A successful live probe (Hermes /api/providers/validate for probeable providers, or the
// out-of-band provider-probe.cjs for Anthropic) produces a ProviderValidation record
// scoped to the exact provider+model. We persist ONLY that non-secret metadata (never the
// key/value/message) into the Hermes-owned profile so it survives restart until its TTL,
// and refresh it back into app state. Onboarding completion gates on a FRESH record for
// the active provider+model (src/lib/provider-validation.ts::providerVerifiedForOnboarding),
// so "configured but never actually reached" — and reachable:false — can never complete.
//
// Stored under the active profile's home (respects the QA runtime override in paths.cjs,
// so packaged E2E never touches the live profile).

const ALLOWED_METHODS = new Set(['validate', 'inference'])

function evidencePath() {
  return path.join(hermesHome(), 'business-state', 'provider-validation.json')
}

// Reconstruct a CLEAN record from only the allow-listed, correctly-typed fields — never
// pass caller-supplied objects through verbatim, so an unexpected/secret-bearing field can
// never be persisted. Returns null when the record is not a well-formed evidence object.
function sanitizeEvidence(input) {
  if (!input || typeof input !== 'object') return null
  const provider = typeof input.provider === 'string' ? input.provider : null
  const validatedAt = typeof input.validatedAt === 'string' ? input.validatedAt : null
  if (!provider || !validatedAt) return null
  if (!Number.isFinite(Date.parse(validatedAt))) return null
  const method = ALLOWED_METHODS.has(input.method) ? input.method : 'validate'
  return {
    provider,
    model: typeof input.model === 'string' ? input.model : null,
    validatedAt,
    ok: input.ok === true,
    reachable: input.reachable === true,
    method
  }
}

// Read the persisted evidence, or null. Fail closed on any read/parse error (a missing or
// corrupt record must read as "no evidence", never as a stale pass).
function getProviderEvidence() {
  try {
    const raw = fs.readFileSync(evidencePath(), 'utf8')
    return sanitizeEvidence(JSON.parse(raw))
  } catch {
    return null
  }
}

// Persist a sanitized, non-secret record atomically. Refuses (returns null) anything that
// is not well-formed evidence.
function recordProviderEvidence(evidence) {
  const clean = sanitizeEvidence(evidence)
  if (!clean) return null
  safeWrite(evidencePath(), JSON.stringify(clean, null, 2))
  return clean
}

function clearProviderEvidence() {
  try {
    fs.rmSync(evidencePath(), { force: true })
  } catch {
    /* best effort */
  }
}

module.exports = {
  evidencePath,
  sanitizeEvidence,
  getProviderEvidence,
  recordProviderEvidence,
  clearProviderEvidence
}
