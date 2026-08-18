// PURE decision layer for the MANAGED download of a תכל'ס (companion) update.
// No fetch, no fs, no electron, no crypto state — decisions only, so every
// fail-closed branch is a pure function of its inputs and is unit-testable
// without a network or a 104 MB file. Same doctrine (and same split) as
// companion-update-core.cjs vs companion-update.cjs; the impure streaming half
// lives in companion-download.cjs.
//
// What this module decides:
//   * which GitHub release ASSETS are the installer and the signed manifest,
//   * whether an asset URL is one we are allowed to fetch at all,
//   * whether a declared/received byte count is sane,
//   * whether a measured SHA-256 matches the AUTHENTICATED one,
//   * whether there is plausibly enough disk space,
//   * and the Hebrew message shown for each failure code.
//
// What it deliberately does NOT decide: whether the manifest is authentic. That
// is update-manifest-verify.cjs's job and it must run BEFORE any of the byte
// checks here are meaningful — a digest comparison against an unauthenticated
// number proves nothing at all.

const { DOWNLOAD_URL_PREFIX } = require('./companion-update-core.cjs')
const { expectedInstallerName } = require('./update-artifact-name.cjs')

/** The manifest asset's fixed basename on the GitHub release. */
const MANIFEST_ASSET_NAME = 'update-manifest.json'

// ── URL allow-list ───────────────────────────────────────────────────────────
// The CHECK already constrains the release page link to
// `https://github.com/NehoraiHadad/hermes-business/releases/` (§6.3). Release
// ASSETS live one level deeper, under `.../releases/download/<tag>/<name>`, so
// they satisfy that prefix — but "satisfies the looser rule" is not the same
// claim as "is an asset of our repo", and this module is about to hand the URL
// to a streamed fetch whose bytes we will later execute. So the asset prefix is
// asserted EXPLICITLY, and it is DERIVED from the check's constant rather than
// re-typed, so the two can never drift.
const ASSET_URL_PREFIX = `${DOWNLOAD_URL_PREFIX}download/`
// Origin + normalized path prefix, derived from the same literal. Used for the
// second, structural half of the check (see sanitizeAssetUrl).
const ASSET_URL_ORIGIN = new URL(ASSET_URL_PREFIX).origin
const ASSET_URL_PATH_PREFIX = new URL(ASSET_URL_PREFIX).pathname

/**
 * Validate a release-asset download URL. Returns the URL unchanged, or `null`.
 *
 * TWO independent checks, both required:
 *
 *  1. A literal `startsWith(ASSET_URL_PREFIX)` on the RAW string. `startsWith`
 *     anchors at position 0, so the literal `github.com/` must appear verbatim
 *     right after the scheme — a look-alike host such as
 *     `https://github.com.evil.tld/NehoraiHadad/...` never matches it, and an
 *     `http://` downgrade fails on the scheme.
 *  2. A STRUCTURAL check on the parsed URL: exact origin, no embedded
 *     credentials, and a NORMALIZED pathname still under `/…/releases/download/`.
 *     This is what a prefix test alone cannot do: `new URL()` resolves dot
 *     segments, so `…/releases/download/../../../../evil.exe` — which passes a
 *     naive prefix test — normalizes to `/evil.exe` and is rejected here.
 *
 * A rejected URL is never "repaired" or substituted; the caller falls back to
 * the manual download link.
 */
function sanitizeAssetUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(ASSET_URL_PREFIX)) return null
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.origin !== ASSET_URL_ORIGIN) return null
  // Credentials in a URL are never produced by GitHub and are a classic way to
  // make a hostile host look like a familiar one in a rendered string.
  if (parsed.username || parsed.password) return null
  if (!parsed.pathname.startsWith(ASSET_URL_PATH_PREFIX)) return null
  return url
}

// Every code `selectUpdateAssets` can report. A missing asset is NOT an error
// state of the check — it means "this release has no managed-update payload,
// fall back to the manual download link" — so the codes are named for what is
// absent rather than for a failure.
const ASSET_CODES = Object.freeze([
  'version-absent',
  'assets-absent',
  'installer-asset-absent',
  'manifest-asset-absent',
  'installer-url-rejected',
  'manifest-url-rejected'
])

function assetFail(code, detail) {
  return { ok: false, code, detail, installerUrl: null, manifestUrl: null, installerName: null }
}

// Exact, case-SENSITIVE name match. The installer name is pinned by the release
// contract and produced by our own pipeline, so a case-insensitive match would
// only ever widen the door to an asset we did not publish under that exact name.
function findAsset(assets, name) {
  for (const asset of assets) {
    if (asset && typeof asset === 'object' && asset.name === name) return asset
  }
  return null
}

/**
 * Pick the two assets a managed update needs out of a raw GitHub release's
 * `assets[]`:
 *   installer — the asset named EXACTLY `Tachles-Setup-<version>.exe`
 *               (update-artifact-name.cjs, the same template the release gate
 *               and the manifest verifier use — never a second literal),
 *   manifest  — the asset named exactly `update-manifest.json`.
 *
 * Returns `{ ok, installerUrl, manifestUrl, installerName, code, detail }`.
 * `ok:false` is an HONEST "managed update unavailable for this release", not a
 * failure of the update check: the caller keeps reporting `update-available`
 * with the manual `downloadUrl` and states WHY the managed path is off.
 */
function selectUpdateAssets({ assets, version } = {}) {
  if (typeof version !== 'string' || version === '') {
    return assetFail('version-absent', 'no target version — cannot derive the pinned installer asset name')
  }
  if (!Array.isArray(assets) || assets.length === 0) {
    return assetFail('assets-absent', 'release carries no assets')
  }
  const installerName = expectedInstallerName(null, version)
  const installer = findAsset(assets, installerName)
  if (!installer) {
    return assetFail('installer-asset-absent', `release has no asset named ${JSON.stringify(installerName)}`)
  }
  const manifest = findAsset(assets, MANIFEST_ASSET_NAME)
  if (!manifest) {
    return assetFail('manifest-asset-absent', `release has no asset named ${JSON.stringify(MANIFEST_ASSET_NAME)} — an unsigned release is never installed automatically`)
  }
  const installerUrl = sanitizeAssetUrl(installer.browser_download_url)
  if (!installerUrl) {
    return assetFail('installer-url-rejected', `installer asset URL is not under ${ASSET_URL_PREFIX}`)
  }
  const manifestUrl = sanitizeAssetUrl(manifest.browser_download_url)
  if (!manifestUrl) {
    return assetFail('manifest-url-rejected', `manifest asset URL is not under ${ASSET_URL_PREFIX}`)
  }
  return { ok: true, code: null, detail: `managed update assets resolved for v${version}`, installerUrl, manifestUrl, installerName }
}

// ── digests ──────────────────────────────────────────────────────────────────

const SHA256_HEX = /^[0-9a-f]{64}$/

/**
 * Normalize a candidate SHA-256 to the ONE canonical spelling (64 lowercase hex)
 * or return `null`. Case is folded here — and ONLY here — because both sides of
 * the comparison are normalized identically: the manifest's digest is already
 * required to be lowercase by the verifier, and our own createHash().digest('hex')
 * is lowercase, so folding can never turn a mismatch into a match. Anything that
 * is not exactly 64 hex characters is rejected outright rather than padded,
 * trimmed into shape, or compared loosely.
 */
function normalizeSha256(value) {
  if (typeof value !== 'string') return null
  const lowered = value.trim().toLowerCase()
  return SHA256_HEX.test(lowered) ? lowered : null
}

/**
 * Compare two SHA-256 hex strings. Both are normalized first; a non-64-hex value
 * on either side NEVER matches anything (it is not "unknown, assume ok").
 *
 * The loop is length-independent and accumulates differences instead of
 * returning early. A digest comparison is not a secret-key operation, so this is
 * belt-and-braces rather than a hard requirement — but the early-exit version is
 * the kind of detail that gets copied into a place where it does matter.
 */
function digestsMatch(a, b) {
  const x = normalizeSha256(a)
  const y = normalizeSha256(b)
  if (!x || !y) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return diff === 0
}

// ── sizes ────────────────────────────────────────────────────────────────────

/**
 * Sanity-check the SERVER-DECLARED length (`Content-Length`) against the
 * AUTHENTICATED byte count from the signed manifest, BEFORE a single byte is
 * streamed. Catches a substituted/oversized body at zero cost.
 *
 * Two deliberate tolerances:
 *   * an absent or unparseable header is NOT a failure — plenty of proxies drop
 *     it, and the authoritative check is the measured size + digest at the end;
 *   * a transforming `Content-Encoding` (anything other than `identity`) makes
 *     the declared length describe the COMPRESSED body, which is a different
 *     number by design, so the comparison is skipped rather than failed. GitHub
 *     does not compress binary release assets, so this branch is defensive.
 *
 * Returns `{ ok, code, detail, declaredBytes }` — `declaredBytes` is the number
 * the progress bar may use, or `null` when there is nothing trustworthy to use.
 */
function checkDeclaredSize({ contentLength, contentEncoding, expectedBytes } = {}) {
  if (!Number.isInteger(expectedBytes) || expectedBytes <= 0) {
    return { ok: false, code: 'expected-bytes-invalid', detail: `expected byte count must be a positive integer, got ${JSON.stringify(expectedBytes)}`, declaredBytes: null }
  }
  const encoding = typeof contentEncoding === 'string' ? contentEncoding.trim().toLowerCase() : ''
  if (encoding && encoding !== 'identity') {
    return { ok: true, code: null, detail: `Content-Length skipped: transforming Content-Encoding ${JSON.stringify(encoding)}`, declaredBytes: null }
  }
  if (contentLength === null || contentLength === undefined || contentLength === '') {
    return { ok: true, code: null, detail: 'no Content-Length header (tolerated)', declaredBytes: null }
  }
  const declared = Number(contentLength)
  if (!Number.isInteger(declared) || declared < 0) {
    return { ok: true, code: null, detail: `unparseable Content-Length ${JSON.stringify(contentLength)} (tolerated)`, declaredBytes: null }
  }
  if (declared !== expectedBytes) {
    return {
      ok: false,
      code: 'installer-size-declared-mismatch',
      detail: `server declares ${declared} bytes but the signed manifest says ${expectedBytes} — refusing to stream a body that is already the wrong size`,
      declaredBytes: declared
    }
  }
  return { ok: true, code: null, detail: `Content-Length agrees with the signed manifest (${declared} bytes)`, declaredBytes: declared }
}

/**
 * Compare what we actually received against the AUTHENTICATED size. Truncation
 * and overrun get distinct codes because they mean different things: a truncated
 * body is the classic dropped-connection case, an oversized one means the server
 * sent something that is not the file the manifest describes.
 */
function checkReceivedSize({ receivedBytes, expectedBytes } = {}) {
  if (!Number.isInteger(expectedBytes) || expectedBytes <= 0) {
    return { ok: false, code: 'expected-bytes-invalid', detail: `expected byte count must be a positive integer, got ${JSON.stringify(expectedBytes)}` }
  }
  if (!Number.isInteger(receivedBytes) || receivedBytes < 0) {
    return { ok: false, code: 'received-bytes-invalid', detail: `received byte count must be a non-negative integer, got ${JSON.stringify(receivedBytes)}` }
  }
  if (receivedBytes < expectedBytes) {
    return { ok: false, code: 'installer-truncated', detail: `download ended after ${receivedBytes} of ${expectedBytes} bytes` }
  }
  if (receivedBytes > expectedBytes) {
    return { ok: false, code: 'installer-oversize', detail: `download delivered ${receivedBytes} bytes but the signed manifest says ${expectedBytes}` }
  }
  return { ok: true, code: null, detail: `received exactly the ${expectedBytes} bytes the signed manifest describes` }
}

// Headroom on top of the installer itself: NSIS extracts its payload to a temp
// dir while running, and a machine that fills up mid-install is a far worse
// outcome than a download we declined to start.
const FREE_SPACE_MARGIN_BYTES = 512 * 1024 * 1024

/**
 * Is there OBVIOUSLY not enough room? Fails the download only on a POSITIVE
 * measurement that says so.
 *
 * Note the asymmetry, which is deliberate: an UNKNOWN amount of free space
 * (statfs unsupported/threw) returns ok. This one check is not a security
 * control — it exists to turn a confusing ENOSPC halfway through a 104 MB
 * download into an immediate, honest Hebrew message. Blocking every update on a
 * platform where we cannot measure would trade a nuisance for an outage, and the
 * write itself still fails closed if the disk really is full.
 */
function checkFreeSpace({ freeBytes, requiredBytes, marginBytes = FREE_SPACE_MARGIN_BYTES } = {}) {
  if (!Number.isInteger(requiredBytes) || requiredBytes <= 0) {
    return { ok: false, code: 'expected-bytes-invalid', detail: `required byte count must be a positive integer, got ${JSON.stringify(requiredBytes)}` }
  }
  if (typeof freeBytes !== 'number' || !Number.isFinite(freeBytes) || freeBytes < 0) {
    return { ok: true, code: null, detail: 'free disk space could not be measured — not a proof of insufficiency' }
  }
  const needed = requiredBytes + Math.max(0, marginBytes)
  if (freeBytes < needed) {
    return { ok: false, code: 'disk-space-insufficient', detail: `${freeBytes} bytes free, ${needed} needed (installer ${requiredBytes} + ${marginBytes} headroom)` }
  }
  return { ok: true, code: null, detail: `${freeBytes} bytes free, ${needed} needed` }
}

/**
 * The overall "may we hand these bytes to the apply stage?" verdict, over the
 * AUTHENTICATED expectations (from the verified manifest) and the MEASURED
 * facts (from the stream).
 *
 * Size first, then digest: both are conclusive, but the size failure names the
 * actual event (a truncated transfer) instead of reporting the generic "digest
 * mismatch" that a truncated file also produces. Neither check is optional —
 * the digest is the binding one, the size is what makes the error legible.
 */
function decideInstallerAcceptance({ expectedSha256, expectedBytes, receivedSha256, receivedBytes } = {}) {
  const size = checkReceivedSize({ receivedBytes, expectedBytes })
  if (!size.ok) return size
  const expected = normalizeSha256(expectedSha256)
  if (!expected) {
    return { ok: false, code: 'installer-digest-malformed', detail: `the manifest's installer.sha256 is not 64 hex characters: ${JSON.stringify(expectedSha256)}` }
  }
  const received = normalizeSha256(receivedSha256)
  if (!received) {
    return { ok: false, code: 'installer-digest-malformed', detail: `the measured digest is not 64 hex characters: ${JSON.stringify(receivedSha256)}` }
  }
  if (!digestsMatch(expected, received)) {
    return { ok: false, code: 'installer-digest-mismatch', detail: `downloaded bytes hash to ${received} but the signed manifest says ${expected}` }
  }
  return { ok: true, code: null, detail: `installer bytes match the signed digest ${expected}` }
}

// ── user-facing copy ─────────────────────────────────────────────────────────
//
// Hebrew, and phrased for a non-technical user: what happened, and what is true
// about their machine now. Every managed-download failure leaves the machine
// EXACTLY as it was (the partial file is deleted, nothing is installed), so every
// message says so — and every one of them points at the manual download, which
// always remains available.

const DOWNLOAD_MESSAGES = Object.freeze({
  'download-disabled': 'הורדת עדכונים מנוטרלת בסביבה הזו. לא בוצע שינוי.',
  busy: 'הורדת עדכון כבר מתבצעת',
  cancelled: 'ההורדה בוטלה. לא בוצע שינוי.',
  'target-version-invalid': 'גרסת היעד אינה תקינה — לא ניתן להוריד עדכון. לא בוצע שינוי. אפשר להוריד ידנית מדף ההורדות.',
  'installer-url-rejected': 'כתובת ההורדה אינה מזוהה כמקור הרשמי. ההורדה בוטלה, לא בוצע שינוי. אפשר להוריד ידנית מדף ההורדות.',
  'manifest-url-rejected': 'כתובת קובץ האימות אינה מזוהה כמקור הרשמי. ההורדה בוטלה, לא בוצע שינוי. אפשר להוריד ידנית מדף ההורדות.',
  'manifest-fetch-failed': 'לא ניתן להוריד את קובץ האימות של העדכון. לא בוצע שינוי.',
  'manifest-parse-failed': 'קובץ האימות של העדכון אינו קריא. לא בוצע שינוי.',
  'manifest-unverified': 'קובץ האימות של העדכון לא עבר בדיקת חתימה — העדכון לא הורד. לא בוצע שינוי.',
  'state-dir-unavailable': 'לא ניתן להכין תיקייה להורדת העדכון. לא בוצע שינוי.',
  'disk-space-insufficient': 'אין מספיק מקום פנוי בדיסק להורדת העדכון. פנו מקום ונסו שוב.',
  'installer-fetch-failed': 'לא ניתן להוריד את קובץ ההתקנה. לא בוצע שינוי.',
  'installer-body-absent': 'השרת לא החזיר את תוכן קובץ ההתקנה. לא בוצע שינוי.',
  'installer-size-declared-mismatch': 'גודל קובץ ההתקנה אינו תואם לעדכון החתום — ההורדה בוטלה. לא בוצע שינוי.',
  'installer-truncated': 'ההורדה נקטעה לפני סיומה. הקובץ החלקי נמחק. לא בוצע שינוי.',
  'installer-oversize': 'קובץ ההתקנה גדול מהצפוי — הקובץ נמחק. לא בוצע שינוי.',
  'installer-digest-malformed': 'לא ניתן לאמת את קובץ ההתקנה — הקובץ נמחק. לא בוצע שינוי.',
  'installer-digest-mismatch': 'קובץ ההתקנה שהתקבל אינו תואם לחתימה — הקובץ נמחק. לא בוצע שינוי.',
  'expected-bytes-invalid': 'פרטי העדכון החתום אינם תקינים. לא בוצע שינוי.',
  'received-bytes-invalid': 'פרטי העדכון החתום אינם תקינים. לא בוצע שינוי.',
  'write-failed': 'לא ניתן לשמור את קובץ ההתקנה לדיסק. לא בוצע שינוי.',
  unexpected: 'ההורדה נכשלה. לא בוצע שינוי.'
})

/** Every failure code the download engine can resolve with. */
const DOWNLOAD_CODES = Object.freeze(Object.keys(DOWNLOAD_MESSAGES))

/**
 * Hebrew copy for a code. An UNKNOWN code falls back to the generic failure
 * message rather than leaking a raw English code into the UI — but it is still a
 * failure, never a silent success.
 */
function messageForDownloadCode(code) {
  return Object.prototype.hasOwnProperty.call(DOWNLOAD_MESSAGES, code) ? DOWNLOAD_MESSAGES[code] : DOWNLOAD_MESSAGES.unexpected
}

module.exports = {
  MANIFEST_ASSET_NAME,
  ASSET_URL_PREFIX,
  ASSET_CODES,
  DOWNLOAD_CODES,
  DOWNLOAD_MESSAGES,
  FREE_SPACE_MARGIN_BYTES,
  SHA256_HEX,
  sanitizeAssetUrl,
  selectUpdateAssets,
  normalizeSha256,
  digestsMatch,
  checkDeclaredSize,
  checkReceivedSize,
  checkFreeSpace,
  decideInstallerAcceptance,
  messageForDownloadCode
}
