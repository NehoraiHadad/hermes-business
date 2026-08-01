// Production-side redaction for diagnostics free-text.
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
 * Full defense-in-depth scrub for diagnostics free-text: query-string
 * tokens/codes, Authorization (Bearer/Basic) headers, JSON-ish secret fields,
 * well-known key shapes (OpenAI `sk-`, Google `AIza`, Telegram bot tokens),
 * personal home-directory paths and email addresses. Idempotent.
 */
function redactSecrets(value) {
  return redactEmails(
    redactPaths(
      String(value == null ? '' : value)
        .replace(
          /([?&](?:token|ticket|code|secret|api[_-]?key|access_token|refresh_token|password)=)[^&\s]+/gi,
          '$1<redacted>'
        )
        .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{8,}=*/g, '$1 <redacted>')
        .replace(
          /(["']?(?:token|ticket|secret|api[_-]?key|access_token|refresh_token|password|session_token)["']?\s*[:=]\s*["'])[^"']+(["'])/gi,
          '$1<redacted>$2'
        )
        .replace(/\b(sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|\d{7,}:[A-Za-z0-9_-]{20,})\b/g, '<redacted>')
    )
  )
}

module.exports = {
  redactEmails,
  redactPaths,
  redactSecrets,
  EMAIL_PATTERN_SOURCE: EMAIL.source
}
