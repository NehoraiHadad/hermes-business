const { readCodexAccessToken, decodeJwtClaims, accountIdHeader } = require('./codex-token-store.cjs')

// Real, NON-DESTRUCTIVE liveness probe for an EXISTING Codex (ChatGPT) OAuth grant.
//
// Hermes' `GET /api/providers/oauth` reports openai-codex `logged_in:true` from a
// REFRESH-FREE on-disk snapshot (auth.json creds exist + access token not obviously
// expiring). That proves credentials are STORED, NOT that the grant currently works — a
// revoked/expired/server-side-invalidated grant still reads logged_in:true. Issuing 24h
// provider evidence off that snapshot is the flaw this closes.
//
// This probe answers "does the grant work RIGHT NOW?" the exact way the Codex CLI does,
// and it holds itself to the SAME fail-closed semantics as installed Hermes 0.19.1
// `hermes_cli.auth._probe_codex_quota_restored`:
//   • JWT-first      — a stored token that is not a structurally decodable JWT is refused
//                      BEFORE any network call (a corrupt/placeholder token can never prove
//                      a live grant; official returns indeterminate for the same case).
//   • authenticated  — a revoked/expired token is rejected (401/403).
//   • non-destructive — GET only; no token rotation, no writes to auth.json.
//   • non-billable    — `/usage` returns rate-limit metadata, never generated content.
//   • usable-only     — ONLY an exact HTTP 200 carrying the expected `/usage` payload with a
//                       rate-limit window below 100% used proves a USABLE grant (ok:true).
//                       A 429 means the grant is valid but its quota is EXHAUSTED — re-auth
//                       cannot lift a quota cap, so it must NOT mint onboarding evidence and
//                       is treated ok:false. A malformed/unexpected 200 body, a non-200 2xx
//                       (no usage payload), or any other status is reachable but NOT proof.
//   • fail-closed     — no token / non-JWT / offline ⇒ reachable:false; everything short of a
//                       proven-usable 200 ⇒ ok:false. NEVER a blind pass.
// The stored access token and the JWT gate live in ./codex-token-store.cjs, which reads the
// token into memory only to set the Authorization header — it is never logged, returned, or
// persisted. `fetchImpl`, `baseUrl` and `readToken` are injectable so tests drive a fake
// endpoint and never read the live profile or spend a real credential.

const DEFAULT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex'

// Mirror hermes_cli.auth._codex_usage_probe_url: a base containing `/backend-api` uses the
// ChatGPT `/wham/usage` path; anything else uses `/api/codex/usage`.
function codexUsageUrl(baseUrl) {
  let normalized = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!normalized) normalized = DEFAULT_CODEX_BASE_URL
  if (normalized.endsWith('/codex')) normalized = normalized.slice(0, -'/codex'.length)
  const prefix = normalized + (normalized.includes('/backend-api') ? '/wham' : '/api/codex')
  return `${prefix}/usage`
}

// The WORST (highest) used_percent across the reported rate-limit windows, or null when the
// body is not the expected `/usage` shape / carries no numeric window. This is the one true
// "% of quota used" number a Codex account exposes. Never throws.
function worstUsedPercent(payload) {
  if (!payload || typeof payload !== 'object') return null
  const rateLimit = payload.rate_limit
  if (!rateLimit || typeof rateLimit !== 'object') return null
  let worstUsed = null
  for (const key of ['primary_window', 'secondary_window']) {
    const window = rateLimit[key]
    const used = window && typeof window === 'object' ? window.used_percent : undefined
    if (typeof used === 'number' && Number.isFinite(used)) {
      worstUsed = Math.max(worstUsed === null ? 0 : worstUsed, used)
    }
  }
  return worstUsed
}

// Does a parsed 200 `/usage` body prove a USABLE grant? Mirrors official
// `_probe_codex_quota_restored`: the body must be the expected shape (an object with a
// `rate_limit` object) AND every reported rate-limit window must be below 100% used. A body
// with no numeric window (worst-used indeterminate) or a fully-used window is NOT proof, so
// it fails closed. Never throws.
function usageProvesUsableGrant(payload) {
  const worstUsed = worstUsedPercent(payload)
  return worstUsed !== null && worstUsed < 100
}

// Probe the existing grant. { ok, reachable, message, usedPercent?, quotaExhausted? }:
//   ok:true,  reachable:true  — grant is proven USABLE (exact 200 + usage shape < 100% used);
//                               carries `usedPercent` (worst window) for display.
//   ok:false, reachable:true  — reached the provider but the grant is NOT proven usable:
//                               rejected (401/403), quota exhausted (429 or a 100%-used
//                               window — both additionally flagged `quotaExhausted:true`),
//                               a malformed/unexpected 200 body, or any other status.
//   ok:false, reachable:false — could not probe (no token / non-JWT token / offline);
//                               NOT proof either way.
// The extra display fields never loosen the evidence gate: gateExistingCodexGrant keys off
// ok/reachable only.
async function probeCodexGrant(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    return { ok: false, reachable: false, message: 'אין יכולת רשת לאימות החיבור בסביבה זו' }
  }
  const readToken = options.readToken || (() => readCodexAccessToken(options))
  const token = String(readToken() || '').trim()
  if (!token) {
    return { ok: false, reachable: false, message: 'לא נמצא חיבור ChatGPT שמור לאימות. חבר/י מחדש דרך ChatGPT.' }
  }
  // JWT-first gate (official semantics): refuse a non-JWT token BEFORE any network call.
  // A corrupt/placeholder token can never prove a live grant, and we must not spend a
  // request — or risk leaking a malformed bearer — on it. Fails closed (reachable:false ⇒
  // NOT proof). The token itself never appears in this (or any) message.
  const claims = decodeJwtClaims(token)
  if (Object.keys(claims).length === 0) {
    return { ok: false, reachable: false, message: 'לא נמצא חיבור ChatGPT תקין לאימות. חבר/י מחדש דרך ChatGPT.' }
  }
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
    'user-agent': 'codex-cli'
  }
  const accountId = accountIdHeader(claims)
  if (accountId) headers['chatgpt-account-id'] = accountId

  let resp
  try {
    resp = await fetchImpl(codexUsageUrl(options.baseUrl), { method: 'GET', headers })
  } catch {
    // Swallow the network error entirely — it can carry request context; never surface it.
    return { ok: false, reachable: false, message: 'לא ניתן היה להגיע ל־ChatGPT כדי לאמת את החיבור' }
  }
  const status = Number(resp && resp.status)
  if (status === 401 || status === 403) {
    return { ok: false, reachable: true, message: 'חיבור ה־ChatGPT פג או בוטל. חבר/י מחדש דרך ChatGPT.' }
  }
  // Only an EXACT 200 carries the Codex `/usage` payload (official special-cases
  // status_code == 200). Any 2xx that is not 200 carries no usage shape, so it cannot prove
  // a usable grant and is treated as indeterminate below.
  if (status === 200) {
    let payload = null
    try {
      payload = typeof resp.json === 'function' ? await resp.json() : null
    } catch {
      payload = null // Malformed body ⇒ not proof; never surface parse internals.
    }
    const usedPercent = worstUsedPercent(payload)
    if (usageProvesUsableGrant(payload)) {
      return { ok: true, reachable: true, usedPercent }
    }
    // A well-shaped body with a fully-used window is a KNOWN-exhausted quota, not an
    // unexpected response — flag it so display surfaces can say so honestly.
    if (usedPercent !== null && usedPercent >= 100) {
      return {
        ok: false,
        reachable: true,
        quotaExhausted: true,
        usedPercent,
        message: 'מכסת ה־ChatGPT מוצתה כרגע; היא תתחדש אוטומטית בהמשך.'
      }
    }
    return { ok: false, reachable: true, message: 'חיבור ה־ChatGPT אינו זמין כעת לשימוש (המכסה מוצתה או שהתשובה אינה צפויה)' }
  }
  // 429 = valid grant, quota EXHAUSTED. Re-auth cannot lift a quota cap, so this must never
  // mint onboarding evidence: reachable but NOT ok.
  if (status === 429) {
    return { ok: false, reachable: true, quotaExhausted: true, message: 'מכסת ה־ChatGPT מוצתה כרגע; חיבור מחדש לא יפתור זאת. נסה/י שוב מאוחר יותר.' }
  }
  return { ok: false, reachable: true, message: `ChatGPT החזיר HTTP ${status || '?'} עבור חיבור זה` }
}

module.exports = {
  probeCodexGrant,
  codexUsageUrl,
  usageProvesUsableGrant,
  worstUsedPercent,
  DEFAULT_CODEX_BASE_URL
}
