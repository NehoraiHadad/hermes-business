const fs = require('node:fs')
const path = require('node:path')
const { hermesHome } = require('./paths.cjs')

// Secret boundary for the Codex (ChatGPT) OAuth probe: reading the stored access token from
// the Hermes-owned auth.json and the structural JWT gate applied to it BEFORE any network
// call. A token that flows through here is read into memory only so the probe can set the
// Authorization header and derive the optional ChatGPT-Account-Id — it is never logged,
// returned to a caller, or persisted. `authPath`/`readFile` are injectable so tests drive a
// fake store and never touch the live profile or spend a real credential.

function authFilePath() {
  return path.join(hermesHome(), 'auth.json')
}

// Best-effort read of a stored Codex access token from the Hermes-owned auth.json.
// Read-only; returns '' when no usable token exists (⇒ probe fails closed). Prefers the
// singleton `providers.openai-codex.tokens`, then any credential-pool entry.
function readCodexAccessToken(options = {}) {
  const readFile = options.readFile || (p => fs.readFileSync(p, 'utf8'))
  const filePath = options.authPath || authFilePath()
  let store
  try {
    store = JSON.parse(readFile(filePath))
  } catch {
    return ''
  }
  if (!store || typeof store !== 'object') return ''
  const singleton = store.providers && store.providers['openai-codex']
  const singletonToken = singleton && singleton.tokens && singleton.tokens.access_token
  if (typeof singletonToken === 'string' && singletonToken.trim()) return singletonToken.trim()
  const pool = store.credential_pool && store.credential_pool['openai-codex']
  if (Array.isArray(pool)) {
    for (const entry of pool) {
      const token = entry && entry.access_token
      if (typeof token === 'string' && token.trim() && entry.last_status !== 'dead') return token.trim()
    }
  }
  return ''
}

// Decode a JWT's claims (middle segment). Mirrors installed Hermes
// `hermes_cli.auth._decode_jwt_claims`: a real JWT has exactly two dots (three segments);
// anything else, or a payload that is not a JSON object, yields {}. Used BOTH as the
// structural JWT gate (empty ⇒ not a JWT ⇒ refuse to probe) and to derive the optional
// ChatGPT-Account-Id header. Never throws; returns {} on any malformation.
function decodeJwtClaims(token) {
  if (typeof token !== 'string' || (token.match(/\./g) || []).length !== 2) return {}
  try {
    const json = Buffer.from(token.split('.')[1], 'base64url').toString('utf8')
    const claims = JSON.parse(json)
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : {}
  } catch {
    return {}
  }
}

// Does a stored token structurally decode as a JWT with at least one claim? Real Codex
// access tokens are JWTs; official refuses to probe anything else. An empty-claims token
// (e.g. a JWT with a `{}` payload) is treated as non-JWT, exactly as official's falsy check.
function isDecodableJwt(token) {
  return Object.keys(decodeJwtClaims(token)).length > 0
}

// Derive the optional ChatGPT-Account-Id header value from decoded JWT claims. Returns null
// when the claim is absent or not a usable string.
function accountIdHeader(claims) {
  const auth = claims && claims['https://api.openai.com/auth']
  const id = auth && typeof auth === 'object' ? auth.chatgpt_account_id : null
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

module.exports = {
  authFilePath,
  readCodexAccessToken,
  decodeJwtClaims,
  isDecodableJwt,
  accountIdHeader
}
