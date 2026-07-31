// Pure, dependency-free contract for the official google-workspace Skill's
// setup.py. It encodes what Hermes v0.19.1 actually supports — line-oriented
// status output, a raw `--auth-url`, a callback-URL `--auth-code`, and a FIXED
// scope set — and stays version-aware by reading `setup.py --help` rather than
// assuming flags. No electron/runtime imports, so it is unit-testable in plain
// Node and reused by both the setup driver and its contract tests.

// Services covered by v0.19.1's FIXED SCOPES. The installed script offers no
// way to select a subset, so the UI must present these as the whole grant
// rather than a menu. Keep in sync with setup.py's SCOPES list.
const GOOGLE_SERVICES = Object.freeze(['Gmail', 'Calendar', 'Drive', 'Contacts', 'Sheets', 'Docs'])

// Parse `setup.py --help` so we only ever pass flags the installed build
// advertises. v0.19.1 exposes none of --services/--format; a future build that
// adds them would light up here without a code change.
function parseHelp(helpText) {
  const text = String(helpText || '')
  const has = flag => text.includes(flag)
  return {
    supportsAuthUrl: has('--auth-url'),
    supportsAuthCode: has('--auth-code'),
    supportsCheck: has('--check'),
    supportsCheckLive: has('--check-live'),
    supportsClientSecret: has('--client-secret'),
    // Invented in earlier experiments; absent in v0.19.1. Never assume these.
    supportsServices: has('--services'),
    supportsFormatJson: has('--format')
  }
}

// `--auth-url` prints ONLY the authorization URL on success (setup.py line ~350).
// Scan from the end for the last bare https URL so leading status noise, if any
// build adds it, is ignored. Never parse JSON — v0.19.1 emits none.
function parseAuthUrl(stdout) {
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^https:\/\/\S+$/.test(lines[i])) return lines[i]
  }
  return null
}

// `--check` / `--check-live` are line-oriented. Recognise the documented status
// tokens instead of guessing a shape. A live failure overrides an earlier
// AUTHENTICATED line so a disabled client never reads as connected.
function parseCheckStatus(stdout) {
  const text = String(stdout || '')
  const liveOk = /^LIVE_CHECK_OK\b/im.test(text)
  const liveFailed = /^LIVE_CHECK_FAILED\b/im.test(text)
  const authenticated = (/^AUTHENTICATED\b/im.test(text) || liveOk) && !liveFailed
  return {
    authenticated,
    partial: /AUTHENTICATED \(partial\)/i.test(text),
    liveOk,
    liveFailed
  }
}

// `--auth-code` prints `OK: Authenticated...` on success and a `WARNING:` line
// when the user granted only a subset of the fixed scopes.
function parseAuthCodeResult(stdout) {
  const text = String(stdout || '')
  return {
    ok: /^OK: Authenticated\b/im.test(text),
    partial: /WARNING: Token missing/i.test(text)
  }
}

// Strip anything that could leak an auth code, client secret, or token before a
// setup error reaches the renderer or logs. Falls back to a generic message so
// we never surface a bare credential even if redaction misses a novel shape.
function safeSetupError(error, fallback) {
  const raw = error && error.message ? String(error.message) : String(error || '')
  const cleaned = raw
    .replace(/([?&](?:code|client_secret|token|access_token|refresh_token)=)[^&\s]+/gi, '$1<redacted>')
    .replace(/\b\d\/[A-Za-z0-9_-]{20,}\b/g, '<redacted>') // bare Google auth codes (e.g. 4/0A...)
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,})\b/g, '<redacted>')
    .trim()
  return cleaned || fallback
}

module.exports = {
  GOOGLE_SERVICES,
  parseHelp,
  parseAuthUrl,
  parseCheckStatus,
  parseAuthCodeResult,
  safeSetupError
}
