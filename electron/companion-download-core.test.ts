import { describe, expect, it } from 'vitest'

// Loaded via require() (not `import`) so this file and the production modules
// resolve to the EXACT SAME Node module singletons — the idiom the rest of the
// electron/*.test.ts suites use.
const {
  MANIFEST_ASSET_NAME,
  ASSET_URL_PREFIX,
  ASSET_CODES,
  DOWNLOAD_CODES,
  DOWNLOAD_MESSAGES,
  FREE_SPACE_MARGIN_BYTES,
  sanitizeAssetUrl,
  selectUpdateAssets,
  normalizeSha256,
  digestsMatch,
  checkDeclaredSize,
  checkReceivedSize,
  checkFreeSpace,
  decideInstallerAcceptance,
  messageForDownloadCode
} = require('./companion-download-core.cjs')
const { DOWNLOAD_URL_PREFIX } = require('./companion-update-core.cjs')
const { expectedInstallerName } = require('./update-artifact-name.cjs')

const VERSION = '0.4.0-alpha.8'
const BASE = `${DOWNLOAD_URL_PREFIX}download/v${VERSION}`
const INSTALLER_NAME = `Tachles-Setup-${VERSION}.exe`
const SHA = 'a'.repeat(64)

function installerAsset(overrides: Record<string, unknown> = {}) {
  return { name: INSTALLER_NAME, browser_download_url: `${BASE}/${INSTALLER_NAME}`, ...overrides }
}
function manifestAsset(overrides: Record<string, unknown> = {}) {
  return { name: MANIFEST_ASSET_NAME, browser_download_url: `${BASE}/${MANIFEST_ASSET_NAME}`, ...overrides }
}

describe('sanitizeAssetUrl — the allow-list a streamed download is fetched through', () => {
  it('derives the asset prefix from the check’s own constant (no second literal)', () => {
    expect(ASSET_URL_PREFIX).toBe(`${DOWNLOAD_URL_PREFIX}download/`)
    expect(ASSET_URL_PREFIX.startsWith('https://github.com/NehoraiHadad/hermes-business/releases/')).toBe(true)
  })

  it('accepts a real release-asset URL', () => {
    const url = `${BASE}/${INSTALLER_NAME}`
    expect(sanitizeAssetUrl(url)).toBe(url)
  })

  it('rejects the release PAGE url — it satisfies the check’s looser prefix but is not an asset', () => {
    expect(sanitizeAssetUrl(`${DOWNLOAD_URL_PREFIX}tag/v${VERSION}`)).toBeNull()
  })

  it('rejects a look-alike host (github.com.evil.tld) — a DIFFERENT origin', () => {
    expect(
      sanitizeAssetUrl(`https://github.com.evil.tld/NehoraiHadad/hermes-business/releases/download/v${VERSION}/${INSTALLER_NAME}`)
    ).toBeNull()
  })

  it('rejects an http:// downgrade', () => {
    expect(
      sanitizeAssetUrl(`http://github.com/NehoraiHadad/hermes-business/releases/download/v${VERSION}/${INSTALLER_NAME}`)
    ).toBeNull()
  })

  it('rejects a path-traversal URL that a naive prefix test would pass', () => {
    // `new URL()` normalizes the dot segments to `/evil.exe`, which is no longer
    // under `/…/releases/download/` — this is exactly what startsWith alone misses.
    expect(sanitizeAssetUrl(`${DOWNLOAD_URL_PREFIX}download/../../../../evil.exe`)).toBeNull()
  })

  it('rejects embedded credentials', () => {
    expect(sanitizeAssetUrl('https://user:pass@github.com/NehoraiHadad/hermes-business/releases/download/v1/x.exe')).toBeNull()
  })

  it('rejects a different repository under the same host', () => {
    expect(sanitizeAssetUrl('https://github.com/attacker/hermes-business/releases/download/v1/x.exe')).toBeNull()
  })

  it('rejects non-strings and garbage', () => {
    for (const bad of [null, undefined, 42, {}, '', 'not a url', 'javascript:alert(1)']) {
      expect(sanitizeAssetUrl(bad as never)).toBeNull()
    }
  })
})

describe('selectUpdateAssets — missing assets are an honest verdict, never a crash', () => {
  it('resolves both URLs and pins the installer name from the ONE template', () => {
    const result = selectUpdateAssets({ assets: [installerAsset(), manifestAsset()], version: VERSION })
    expect(result.ok).toBe(true)
    expect(result.installerName).toBe(expectedInstallerName(null, VERSION))
    expect(result.installerUrl).toBe(`${BASE}/${INSTALLER_NAME}`)
    expect(result.manifestUrl).toBe(`${BASE}/${MANIFEST_ASSET_NAME}`)
    expect(result.code).toBeNull()
  })

  it('ignores unrelated assets around the two it needs', () => {
    const result = selectUpdateAssets({
      assets: [{ name: 'SHA256SUMS.txt', browser_download_url: `${BASE}/SHA256SUMS.txt` }, manifestAsset(), null, installerAsset()],
      version: VERSION
    })
    expect(result.ok).toBe(true)
  })

  it('no assets at all ⇒ assets-absent (manual fallback), not a throw', () => {
    expect(selectUpdateAssets({ assets: [], version: VERSION })).toMatchObject({ ok: false, code: 'assets-absent' })
    expect(selectUpdateAssets({ assets: null as never, version: VERSION })).toMatchObject({ ok: false, code: 'assets-absent' })
    expect(selectUpdateAssets({})).toMatchObject({ ok: false, code: 'version-absent' })
  })

  it('installer present, manifest missing ⇒ manifest-asset-absent (an unsigned release is never auto-installed)', () => {
    expect(selectUpdateAssets({ assets: [installerAsset()], version: VERSION })).toMatchObject({
      ok: false,
      code: 'manifest-asset-absent',
      installerUrl: null
    })
  })

  it('manifest present, installer missing ⇒ installer-asset-absent', () => {
    expect(selectUpdateAssets({ assets: [manifestAsset()], version: VERSION })).toMatchObject({ ok: false, code: 'installer-asset-absent' })
  })

  it('an installer asset for a DIFFERENT version does not satisfy the pinned name', () => {
    const other = installerAsset({ name: 'Tachles-Setup-9.9.9.exe' })
    expect(selectUpdateAssets({ assets: [other, manifestAsset()], version: VERSION })).toMatchObject({ ok: false, code: 'installer-asset-absent' })
  })

  it('name matching is case-SENSITIVE — we only ever accept the exact published name', () => {
    const shouty = installerAsset({ name: INSTALLER_NAME.toUpperCase() })
    expect(selectUpdateAssets({ assets: [shouty, manifestAsset()], version: VERSION })).toMatchObject({ ok: false, code: 'installer-asset-absent' })
  })

  it('a rejected installer URL never leaks a partial result', () => {
    const evil = installerAsset({ browser_download_url: `https://github.com.evil.tld/NehoraiHadad/hermes-business/releases/download/v1/${INSTALLER_NAME}` })
    const result = selectUpdateAssets({ assets: [evil, manifestAsset()], version: VERSION })
    expect(result).toMatchObject({ ok: false, code: 'installer-url-rejected', installerUrl: null, manifestUrl: null })
  })

  it('a rejected manifest URL (http downgrade) fails closed too', () => {
    const evil = manifestAsset({ browser_download_url: `http://github.com/NehoraiHadad/hermes-business/releases/download/v1/${MANIFEST_ASSET_NAME}` })
    expect(selectUpdateAssets({ assets: [installerAsset(), evil], version: VERSION })).toMatchObject({ ok: false, code: 'manifest-url-rejected' })
  })

  it('every code it can emit is declared in ASSET_CODES', () => {
    const emitted = [
      selectUpdateAssets({}),
      selectUpdateAssets({ assets: [], version: VERSION }),
      selectUpdateAssets({ assets: [manifestAsset()], version: VERSION }),
      selectUpdateAssets({ assets: [installerAsset()], version: VERSION }),
      selectUpdateAssets({ assets: [installerAsset({ browser_download_url: 'http://x' }), manifestAsset()], version: VERSION }),
      selectUpdateAssets({ assets: [installerAsset(), manifestAsset({ browser_download_url: 'http://x' })], version: VERSION })
    ].map(r => r.code)
    expect(new Set(emitted)).toEqual(new Set(ASSET_CODES))
  })
})

describe('digest handling — normalization can never turn a mismatch into a match', () => {
  it('normalizes case and surrounding whitespace to the one canonical spelling', () => {
    expect(normalizeSha256(`  ${'A'.repeat(64)}  `)).toBe('a'.repeat(64))
  })

  it('rejects anything that is not exactly 64 hex characters', () => {
    for (const bad of ['', 'a'.repeat(63), 'a'.repeat(65), `${'g'.repeat(64)}`, 42, null, undefined, {}]) {
      expect(normalizeSha256(bad as never)).toBeNull()
    }
  })

  it('matches equal digests across case, and nothing else', () => {
    expect(digestsMatch(SHA, SHA.toUpperCase())).toBe(true)
    expect(digestsMatch(SHA, 'b'.repeat(64))).toBe(false)
    expect(digestsMatch(SHA, `${'a'.repeat(63)}b`)).toBe(false)
  })

  it('a malformed digest on EITHER side never matches — not even another malformed one', () => {
    expect(digestsMatch('nope', 'nope')).toBe(false)
    expect(digestsMatch(SHA, null as never)).toBe(false)
    expect(digestsMatch(undefined as never, undefined as never)).toBe(false)
  })
})

describe('size sanity', () => {
  it('an absent Content-Length is tolerated and yields no denominator', () => {
    expect(checkDeclaredSize({ contentLength: null, expectedBytes: 100 })).toMatchObject({ ok: true, declaredBytes: null })
  })

  it('an agreeing Content-Length is used as the progress denominator', () => {
    expect(checkDeclaredSize({ contentLength: '100', expectedBytes: 100 })).toMatchObject({ ok: true, declaredBytes: 100 })
  })

  it('a Content-Length that disagrees with the SIGNED size fails before a byte is streamed', () => {
    expect(checkDeclaredSize({ contentLength: '999', expectedBytes: 100 })).toMatchObject({
      ok: false,
      code: 'installer-size-declared-mismatch',
      declaredBytes: 999
    })
  })

  it('a transforming Content-Encoding disables the declared-length comparison (different number by design)', () => {
    expect(checkDeclaredSize({ contentLength: '40', contentEncoding: 'gzip', expectedBytes: 100 })).toMatchObject({ ok: true, declaredBytes: null })
    expect(checkDeclaredSize({ contentLength: '100', contentEncoding: 'identity', expectedBytes: 100 })).toMatchObject({ ok: true, declaredBytes: 100 })
  })

  it('an unparseable Content-Length is tolerated, not trusted', () => {
    expect(checkDeclaredSize({ contentLength: 'many', expectedBytes: 100 })).toMatchObject({ ok: true, declaredBytes: null })
  })

  it('a non-positive expected size is itself a failure (the signed doc is nonsense)', () => {
    expect(checkDeclaredSize({ contentLength: '1', expectedBytes: 0 })).toMatchObject({ ok: false, code: 'expected-bytes-invalid' })
  })

  it('truncation and overrun get DIFFERENT codes — they are different events', () => {
    expect(checkReceivedSize({ receivedBytes: 50, expectedBytes: 100 })).toMatchObject({ ok: false, code: 'installer-truncated' })
    expect(checkReceivedSize({ receivedBytes: 150, expectedBytes: 100 })).toMatchObject({ ok: false, code: 'installer-oversize' })
    expect(checkReceivedSize({ receivedBytes: 100, expectedBytes: 100 })).toMatchObject({ ok: true })
  })
})

describe('free space — fails only on a POSITIVE measurement of insufficiency', () => {
  it('passes with room to spare', () => {
    expect(checkFreeSpace({ freeBytes: 10 * FREE_SPACE_MARGIN_BYTES, requiredBytes: 1000 })).toMatchObject({ ok: true })
  })

  it('fails when free space is below installer + headroom', () => {
    expect(checkFreeSpace({ freeBytes: 1000, requiredBytes: 1000 })).toMatchObject({ ok: false, code: 'disk-space-insufficient' })
  })

  it('an UNMEASURABLE amount of free space is not a proof of insufficiency (deliberate fail-open)', () => {
    // This one check is a legibility aid, not a security control: blocking every
    // update where statfs is unavailable would trade a nuisance for an outage,
    // and the write itself still fails closed on a genuinely full disk.
    expect(checkFreeSpace({ freeBytes: null as never, requiredBytes: 1000 })).toMatchObject({ ok: true })
    expect(checkFreeSpace({ freeBytes: Number.NaN, requiredBytes: 1000 })).toMatchObject({ ok: true })
  })

  it('the margin is configurable and respected', () => {
    expect(checkFreeSpace({ freeBytes: 1500, requiredBytes: 1000, marginBytes: 0 })).toMatchObject({ ok: true })
    expect(checkFreeSpace({ freeBytes: 1500, requiredBytes: 1000, marginBytes: 600 })).toMatchObject({ ok: false, code: 'disk-space-insufficient' })
  })
})

describe('decideInstallerAcceptance — the "may we apply this?" verdict', () => {
  const base = { expectedSha256: SHA, expectedBytes: 100, receivedSha256: SHA, receivedBytes: 100 }

  it('accepts only when BOTH the size and the digest match the signed statement', () => {
    expect(decideInstallerAcceptance(base)).toMatchObject({ ok: true })
  })

  it('reports truncation as truncation, not as a generic digest mismatch', () => {
    // A truncated file also hashes differently, but "ההורדה נקטעה" is the true
    // statement about what happened and the one the user can act on.
    expect(decideInstallerAcceptance({ ...base, receivedBytes: 50, receivedSha256: 'b'.repeat(64) })).toMatchObject({
      ok: false,
      code: 'installer-truncated'
    })
  })

  it('right size, wrong bytes ⇒ digest mismatch', () => {
    expect(decideInstallerAcceptance({ ...base, receivedSha256: 'b'.repeat(64) })).toMatchObject({ ok: false, code: 'installer-digest-mismatch' })
  })

  it('a malformed digest on either side is a refusal, never an implicit pass', () => {
    expect(decideInstallerAcceptance({ ...base, expectedSha256: 'nope' })).toMatchObject({ ok: false, code: 'installer-digest-malformed' })
    expect(decideInstallerAcceptance({ ...base, receivedSha256: 'nope' })).toMatchObject({ ok: false, code: 'installer-digest-malformed' })
  })

  it('case differences alone never fail an otherwise identical digest', () => {
    expect(decideInstallerAcceptance({ ...base, receivedSha256: SHA.toUpperCase() })).toMatchObject({ ok: true })
  })
})

describe('user-facing copy', () => {
  it('every declared code has Hebrew copy', () => {
    for (const code of DOWNLOAD_CODES) {
      const message = messageForDownloadCode(code)
      expect(typeof message).toBe('string')
      expect(message.length).toBeGreaterThan(0)
      expect(/[֐-׿]/.test(message)).toBe(true)
    }
  })

  it('an unknown code falls back to the generic failure, never to a raw English code', () => {
    expect(messageForDownloadCode('something-new')).toBe(DOWNLOAD_MESSAGES.unexpected)
    expect(messageForDownloadCode(undefined as never)).toBe(DOWNLOAD_MESSAGES.unexpected)
  })

  it('every failure message tells the user the machine was not changed', () => {
    // The whole engine rolls back on failure (partial file deleted, nothing
    // installed), so the copy must say so — a vague error invites a user to go
    // hunting for a half-installed update that does not exist.
    for (const code of DOWNLOAD_CODES) {
      if (code === 'busy') continue // "a download is already running" is not a failure state
      expect(messageForDownloadCode(code)).toMatch(/לא בוצע שינוי|נסו שוב/)
    }
  })
})
