// Configured is NOT live-verified. A present key/model only proves configuration; only
// a real probe (POST /api/providers/validate → { ok, reachable, message }) or an
// observed successful inference proves the credential currently works. We record ONLY
// non-secret validation metadata (never the key/value) and treat it as evidence that
// EXPIRES and FAILS CLOSED: a revoked, expired, or other-provider/other-model record
// can never present as "verified".

export const VALIDATION_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24h — re-validate daily

// The live probe response shape from web_server.py POST /api/providers/validate.
export type ProviderValidateResponse = { ok?: unknown; reachable?: unknown; message?: unknown }

export type ValidationMethod = 'validate' | 'inference'

// Non-secret evidence of a live validation. `provider`/`model` scope it so a record for
// one provider/model never vouches for another. `ok` is the provider's accept verdict.
export type ProviderValidation = {
  provider: string
  model: string | null
  validatedAt: string
  ok: boolean
  reachable: boolean
  method: ValidationMethod
}

function isFiniteTime(iso: string): number | null {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

// Build the non-secret record from a live /api/providers/validate response. Only ok /
// reachable and the scoping provider/model are kept — no key, no value, no message text
// (which could echo a secret). A non-accepting probe is still recorded (ok:false) so a
// later freshness check fails closed rather than trusting stale success.
export function recordValidation(input: {
  provider: string
  model?: string | null
  response: ProviderValidateResponse
  now: string
  method?: ValidationMethod
}): ProviderValidation {
  return {
    provider: input.provider,
    model: input.model ?? null,
    validatedAt: input.now,
    ok: input.response.ok === true,
    reachable: input.response.reachable === true,
    method: input.method ?? 'validate'
  }
}

// Record a successful inference round-trip as validation evidence (the agent's own live
// reply IS proof the credential works — see the bootstrap provider semantics).
export function recordInferenceSuccess(input: { provider: string; model?: string | null; now: string }): ProviderValidation {
  return { provider: input.provider, model: input.model ?? null, validatedAt: input.now, ok: true, reachable: true, method: 'inference' }
}

// Is `validation` recent, accepting, REACHABLE, and for the CURRENTLY-active provider
// (and model, when the active model is known)? Fails closed on: missing record, ok:false
// (revoked/rejected), reachable:false (an un-probed provider — reachable:false is NOT
// proof), expiry, a different provider, or a different/absent model when an active model
// is known. `maxAgeMs<=0` treats any past record as expired (forces a fresh probe).
export function isValidationFresh(
  validation: ProviderValidation | null | undefined,
  active: { provider: string; model?: string | null; now: string; maxAgeMs?: number }
): boolean {
  if (!validation || validation.ok !== true) return false
  // reachable:false means the credential was never actually reached/verified (e.g. a
  // provider with no probe). It is explicitly NOT proof — refuse it as evidence.
  if (validation.reachable !== true) return false
  if (validation.provider !== active.provider) return false
  // Model scoping: when the active model is known, the record MUST carry that exact model.
  // A record with a null/absent or mismatched model cannot vouch for the active model —
  // this closes the `model=null` bypass where a modelless record vouched for anything.
  if (active.model && validation.model !== active.model) return false
  const at = isFiniteTime(validation.validatedAt)
  const now = isFiniteTime(active.now)
  if (at === null || now === null) return false
  const maxAge = active.maxAgeMs ?? VALIDATION_MAX_AGE_MS
  if (at > now) return false // a future-dated record is not trustworthy
  return now - at <= maxAge
}

// Onboarding-completion gate for the provider: it must be authoritatively usable AND
// carry a recent live validation for the active provider/model. Either missing ⇒ not
// verified (stays blocked), so "configured but never actually reached" cannot complete.
export function providerVerifiedForOnboarding(input: {
  providerUsable: boolean
  activeProvider: string
  activeModel?: string | null
  validation: ProviderValidation | null | undefined
  now: string
  maxAgeMs?: number
}): boolean {
  if (!input.providerUsable) return false
  return isValidationFresh(input.validation, {
    provider: input.activeProvider,
    model: input.activeModel ?? null,
    now: input.now,
    maxAgeMs: input.maxAgeMs
  })
}
