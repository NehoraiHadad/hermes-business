// Production-side redaction for diagnostics free-text AND for the live runtime
// log stream.
//
// This is the ONE redactor in the desktop app. A second, weaker implementation
// used to live in security.cjs and guarded the two highest-volume surfaces (the
// log ring buffer that feeds both `hermes:logs` and the live `hermes:runtime-log`
// push, plus captured-process failure messages) — i.e. the weakest pass guarded
// the most exposed stream. security.cjs is deleted; every pattern it had that was
// not already covered here was migrated below (the `x-hermes-session-token`
// header line, case-insensitive `Bearer`/`Basic`, `client_secret=` query values
// and the legacy Google `1/<refresh token>` shape).
//
// The diagnostics bundle is already strictly allow-listed (see diagnostics.cjs),
// but any Hermes-provided string that survives the allow-list (version banners,
// component state, error text) could in principle embed a secret, a personal
// filesystem path, or an email address. This module is the final, fail-closed
// defense-in-depth pass applied to the serialized bundle before it is written to
// disk: when in doubt it strips rather than keeps.
//
// Email handling preserves the domain (useful technical/routing data) while
// eliminating the user/customer identity: `jane.doe@shop.co.il` becomes
// `<redacted>@shop.co.il`. The canonical email pattern is mirrored in the E2E
// chokepoint `scripts/lib/e2e-harness.mjs` (sanitize) and both are covered by
// focused tests so they cannot drift apart silently.

const EMAIL =
  /[A-Za-z0-9._%+-]+@([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g

// Absolute user-home paths embed the account/login name — a personal identifier
// that would otherwise leak through error text like an ENOENT on a config file.
// Strip ONLY the identity segment (the leaf right after the home root) and keep
// the rest of the path, which is useful for support without revealing who ran it.
// The user segment class forbids separators so exactly one path element is taken;
// the `<redacted>` placeholder likewise contains no separator, keeping the pass
// idempotent. The POSIX lookbehind stops URL segments like `site.com/home/x` from
// being mistaken for a `/home/<user>` path.
const WINDOWS_USER_PATH = /([A-Za-z]:[\\/]Users[\\/])([^\\/:*?"<>|\r\n]+)/gi
const POSIX_USER_PATH = /(?<![\w.-])(\/(?:home|Users)\/)([^/\0\r\n"'\\]+)/g

// Credentials carried in a query string, e.g. `...&client_secret=…`. `code` and
// `ticket` are only redacted in this strict query position, where they are
// unambiguously OAuth material.
const SECRET_QUERY =
  /([?&](?:token|ticket|code|secret|client_secret|session_token|api[_-]?key|access_token|refresh_token|password)=)[^&\s]+/gi

// The same credentials as a bare `name=value` assignment at a line start or after
// whitespace — how they actually appear in a spawned setup command line or an env
// dump reaching the log stream, where there is no `?`/`&` in front of them. Only
// names that are unambiguously secret are matched here, so ordinary text such as
// `exit code=1` stays readable.
const SECRET_ASSIGNMENT =
  /((?:^|[\s;,])(?:client_secret|session_token|access_token|refresh_token|api[_-]?key|password|secret|token)=)[^&\s]+/gim

// Credential-bearing HEADER lines, e.g. the Hermes session-token header the old
// security.cjs guarded (`x-hermes-session-token: <value>`). The value runs to the
// end of the line so a multi-word scheme (`authorization: Bearer <t>`) is removed
// whole; quoted/structured values are excluded so a JSON-ish line keeps its other
// fields, which SECRET_FIELD handles instead. `<redacted>` re-matches to itself,
// keeping the pass idempotent.
const SECRET_HEADER = /((?:authorization|x-[a-z0-9-]*session-token|x-api-key)\s*:[ \t]*)[^\r\n"',}]+/gi

// `Authorization: Bearer …` / `Basic …` anywhere in free text. Case-insensitive
// (migrated from security.cjs, whose header rule was); `$1` preserves the
// original casing. `<redacted>` cannot re-match, so this is idempotent.
const AUTH_SCHEME = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{8,}=*/gi

// Structured secret fields: `"api_key": "…"`, `session_token = '…'`, including
// header-style names such as `"x-hermes-session-token"`.
const SECRET_FIELD =
  /(["']?(?:token|ticket|secret|api[_-]?key|access_token|refresh_token|password|[\w.-]*session[_-]token)["']?\s*[:=]\s*["'])[^"']+(["'])/gi

// Well-known raw key shapes: OpenAI `sk-…`, Google API `AIza…`, Telegram bot
// tokens `<digits>:<token>` and the legacy Google refresh-token shape `1/…`
// (the last one migrated from security.cjs).
const KEY_SHAPES =
  /\b(sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|\d{7,}:[A-Za-z0-9_-]{20,}|\d\/[A-Za-z0-9_-]{20,})\b/g

/**
 * Replace the local part of every email address with `<redacted>` while keeping
 * the domain. The placeholder ends in `>`, which is not a legal local-part
 * character, so the surviving `@` is never re-matched — making the pass
 * idempotent and safe to apply more than once.
 */
function redactEmails(value) {
  return String(value == null ? '' : value).replace(EMAIL, '<redacted>@$1')
}

/**
 * Replace the account/login name inside absolute Windows (`C:\Users\<name>`) and
 * POSIX (`/home/<name>`, `/Users/<name>`) home paths with `<redacted>`, keeping
 * the surrounding path structure intact. Idempotent.
 */
function redactPaths(value) {
  return String(value == null ? '' : value)
    .replace(WINDOWS_USER_PATH, '$1<redacted>')
    .replace(POSIX_USER_PATH, '$1<redacted>')
}

/**
 * Full defense-in-depth scrub for every string that may reach the log ring
 * buffer, the renderer log stream or the diagnostics bundle: query-string
 * tokens/codes, credential header lines, Authorization (Bearer/Basic) values,
 * JSON-ish secret fields, well-known key shapes (OpenAI `sk-`, Google `AIza`,
 * Google `1/` refresh tokens, Telegram bot tokens), personal home-directory
 * paths and email addresses. Idempotent.
 *
 * The header rule runs before the scheme rule so `authorization: Bearer <t>` is
 * collapsed once, to `authorization: <redacted>`.
 */
function redactSecrets(value) {
  return redactEmails(
    redactPaths(
      String(value == null ? '' : value)
        .replace(SECRET_QUERY, '$1<redacted>')
        .replace(SECRET_ASSIGNMENT, '$1<redacted>')
        .replace(SECRET_HEADER, '$1<redacted>')
        .replace(AUTH_SCHEME, '$1 <redacted>')
        .replace(SECRET_FIELD, '$1<redacted>$2')
        .replace(KEY_SHAPES, '<redacted>')
    )
  )
}

module.exports = {
  redactEmails,
  redactPaths,
  redactSecrets,
  EMAIL_PATTERN_SOURCE: EMAIL.source
}
