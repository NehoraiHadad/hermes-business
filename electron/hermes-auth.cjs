// Shared auth-header construction for the managed Hermes runtime.
//
// Hermes 0.19.1 `web_server._has_valid_session_token()` PREFERS the dedicated
// `X-Hermes-Session-Token` header (it avoids colliding with an `Authorization`
// header a reverse proxy may already own) and STILL accepts the legacy
// `Authorization: Bearer <token>` path for older bundles. We send BOTH so the
// companion authenticates against current and older Hermes builds without
// probing the version first.
const SESSION_HEADER = 'X-Hermes-Session-Token'

function authHeaders(token, extra = {}) {
  return {
    [SESSION_HEADER]: token,
    Authorization: `Bearer ${token}`,
    ...extra
  }
}

// Loopback `hermes serve` (bound to 127.0.0.1, `auth_required=false`)
// authenticates the `/api/ws` upgrade with `?token=<session token>` ONLY.
// The single-use `?ticket=` credential in `web_server._ws_auth_reason()` is
// consulted EXCLUSIVELY when `auth_required` is true (the OAuth/public "gated"
// bind); it is never checked on a loopback bind, so minting a ws-ticket could
// not authenticate our WebSocket. The session-token query param is therefore
// the exact, and only, official WS contract for this architecture.
function wsUrlWithToken(baseWsUrl, token) {
  const separator = baseWsUrl.includes('?') ? '&' : '?'
  return `${baseWsUrl}${separator}token=${encodeURIComponent(token)}`
}

module.exports = { SESSION_HEADER, authHeaders, wsUrlWithToken }
