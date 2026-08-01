// Real, cost-bounded credential probes for providers Hermes cannot validate itself.
//
// Hermes' _CREDENTIAL_PROBES (web_server.py) covers OpenRouter/OpenAI/xAI/Gemini via a
// Bearer or query-key GET, but OMITS Anthropic — whose auth is `x-api-key` + an
// `anthropic-version` header, not Bearer. So `POST /api/providers/validate` for an
// Anthropic key returns { ok:true, reachable:false } (the "no probe" branch), which is NOT
// proof the key works. This module performs the missing probe in the MAIN process (no
// browser CORS, and the key never touches the renderer network):
//
//   GET https://api.anthropic.com/v1/models
//     headers: x-api-key: <key>, anthropic-version: 2023-06-01
//
// This is the official, zero-token, no-content-retained key+availability check (mirrors
// the /v1/models pattern Hermes already uses for OpenAI/xAI). 200 ⇒ the key is accepted;
// 401/403 ⇒ rejected (never accept); a network failure ⇒ reachable:false (honest
// "could not verify", never a silent pass). The key is never logged or returned.
//
// `fetchImpl` and `baseUrl` are injectable so tests drive a local fake endpoint and never
// spend a real credential.

const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_ANTHROPIC_BASE = 'https://api.anthropic.com'

// The provider ids (from src/lib/hermes/core.ts PROVIDER_API_KEYS) that Hermes CAN probe
// itself. For these we defer to Hermes' /api/providers/validate (reachable:true) and this
// module is not consulted. Anthropic is the one that needs an out-of-band probe.
const HERMES_PROBED_PROVIDERS = new Set(['openrouter', 'openai', 'gemini'])

async function probeAnthropic(apiKey, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const base = (options.baseUrl || DEFAULT_ANTHROPIC_BASE).replace(/\/+$/, '')
  if (typeof fetchImpl !== 'function') {
    return { ok: false, reachable: false, message: 'אין יכולת רשת לאימות הספק בסביבה זו' }
  }
  const url = `${base}/v1/models`
  let resp
  try {
    resp = await fetchImpl(url, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        accept: 'application/json'
      }
    })
  } catch {
    // Could not run the probe (offline / DNS). reachable:false ⇒ NOT proof, honest failure.
    return { ok: false, reachable: false, message: 'לא ניתן היה להגיע ל־Anthropic כדי לאמת את המפתח' }
  }
  const status = Number(resp && resp.status)
  if (status === 401 || status === 403) {
    return { ok: false, reachable: true, message: 'מפתח ה־API של Anthropic נדחה. בדוק/י אותו ונסה/י שוב.' }
  }
  // 429 = valid key but rate-limited; any 2xx = valid.
  if (status === 429 || (status >= 200 && status < 300)) {
    return { ok: true, reachable: true }
  }
  return { ok: false, reachable: true, message: `Anthropic החזיר HTTP ${status || '?'} עבור מפתח זה` }
}

// Dispatch a supplemental probe for a provider Hermes could not validate. Returns
// reachable:false for an unknown/Hermes-probed provider (caller must not treat that as
// proof). Never accepts an invalid key. `options` (fetchImpl/baseUrl) are for tests.
async function probeProviderCredential(input, options = {}) {
  const provider = String((input && input.provider) || '').toLowerCase()
  const apiKey = (input && input.apiKey) || ''
  if (!apiKey) return { ok: false, reachable: true, message: 'לא הוזן מפתח' }
  if (provider === 'anthropic') return probeAnthropic(apiKey, options)
  // For providers Hermes probes itself we should never reach here; if we do, be honest
  // that this module did not verify them rather than fabricating a pass.
  return {
    ok: false,
    reachable: false,
    message: HERMES_PROBED_PROVIDERS.has(provider)
      ? 'ספק זה מאומת ישירות על ידי Hermes'
      : 'אין בדיקת אימות זמינה לספק זה'
  }
}

module.exports = {
  probeProviderCredential,
  probeAnthropic,
  ANTHROPIC_VERSION,
  HERMES_PROBED_PROVIDERS
}
