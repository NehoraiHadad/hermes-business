// Redact secrets and session tokens from any text that might reach logs, the
// renderer log stream, or the diagnostics bundle. Shared by the log buffer and
// the captured-process helpers so redaction is applied in exactly one place.
function redact(value) {
  return String(value)
    .replace(/([?&](?:token|ticket|code|client_secret|access_token|refresh_token)=)[^&\s]+/gi, '$1<redacted>')
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, '$1<redacted>')
    .replace(/(x-hermes-session-token:\s*)[^\s]+/gi, '$1<redacted>')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|\d{7,}:[A-Za-z0-9_-]{20,}|\d\/[A-Za-z0-9_-]{20,})\b/g, '<redacted>')
    .replace(/("(?:api_key|token|secret|password)"\s*:\s*")[^"]+(")/gi, '$1<redacted>$2')
}

module.exports = { redact }
