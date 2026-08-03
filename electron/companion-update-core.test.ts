import { describe, expect, it } from 'vitest'
// @ts-expect-error - plain CJS module without type declarations
import {
  parseSemver,
  compareSemver,
  selectEligibleRelease,
  decideVerdict,
  sanitizeReleaseNotes,
  sanitizeDownloadUrl,
  DOWNLOAD_URL_PREFIX
} from './companion-update-core.cjs'

describe('parseSemver — strict SemVer 2.0.0, null on anything else', () => {
  it('parses a plain version', () => {
    expect(parseSemver('0.4.0')).toEqual({ major: 0, minor: 4, patch: 0, prerelease: [], raw: '0.4.0' })
  })

  it('accepts an optional leading v (git tag shape)', () => {
    expect(parseSemver('v0.4.0')).toMatchObject({ major: 0, minor: 4, patch: 0, prerelease: [] })
  })

  it('rejects leading zeros in core and numeric-prerelease identifiers (SemVer §2/§9)', () => {
    expect(parseSemver('0.04.0')).toBeNull()
    expect(parseSemver('01.0.0')).toBeNull()
    expect(parseSemver('0.4.0-alpha.01')).toBeNull()
    // Alphanumeric identifiers may start with 0 — they compare lexically.
    expect(parseSemver('0.4.0-0abc')).toMatchObject({ prerelease: ['0abc'] })
    expect(parseSemver('0.4.0-alpha.0')).toMatchObject({ prerelease: ['alpha', '0'] })
  })

  it('parses a dotted prerelease suffix into identifiers', () => {
    expect(parseSemver('0.4.0-alpha.9')).toMatchObject({ prerelease: ['alpha', '9'] })
    expect(parseSemver('1.2.0-beta.1')).toMatchObject({ prerelease: ['beta', '1'] })
  })

  it('trims surrounding whitespace', () => {
    expect(parseSemver('  0.4.0  ')).toMatchObject({ major: 0, minor: 4, patch: 0 })
  })

  it('returns null for anything that is not exactly x.y.z[-prerelease]', () => {
    expect(parseSemver('0.4')).toBeNull()
    expect(parseSemver('0.4.0.1')).toBeNull()
    expect(parseSemver('0.4.0+build.5')).toBeNull() // build metadata not accepted
    expect(parseSemver('not-a-version')).toBeNull()
    expect(parseSemver('')).toBeNull()
    expect(parseSemver('v')).toBeNull()
    expect(parseSemver(null)).toBeNull()
    expect(parseSemver(undefined)).toBeNull()
    expect(parseSemver(42)).toBeNull()
    expect(parseSemver({})).toBeNull()
  })

  it('never throws on hostile input', () => {
    expect(() => parseSemver('   '.repeat(1000))).not.toThrow()
    expect(() => parseSemver(['0.4.0'])).not.toThrow()
  })
})

describe('compareSemver — full SemVer 2.0.0 ordering (§11)', () => {
  it('orders major/minor/patch numerically (not lexically)', () => {
    expect(compareSemver('0.10.0', '0.9.0')).toBe(1)
    expect(compareSemver('2.0.0', '10.0.0')).toBe(-1)
    expect(compareSemver('0.4.1', '0.4.0')).toBe(1)
  })

  it('a stable version outranks any prerelease of the same core (0.4.0 > 0.4.0-alpha.9)', () => {
    expect(compareSemver('0.4.0', '0.4.0-alpha.9')).toBe(1)
    expect(compareSemver('0.4.0-alpha.9', '0.4.0')).toBe(-1)
  })

  it('numeric prerelease identifiers compare numerically, not lexically (alpha.2 < alpha.10)', () => {
    expect(compareSemver('0.4.0-alpha.2', '0.4.0-alpha.10')).toBe(-1)
    expect(compareSemver('0.4.0-alpha.10', '0.4.0-alpha.2')).toBe(1)
    // A naive string compare would say '10' < '2' — assert we are NOT doing that.
    expect(compareSemver('0.4.0-alpha.9', '0.4.0-alpha.10')).toBe(-1)
  })

  it('a purely-numeric identifier has lower precedence than an alphanumeric one', () => {
    expect(compareSemver('0.4.0-1', '0.4.0-alpha')).toBe(-1)
  })

  it('alphanumeric identifiers compare lexically (ASCII)', () => {
    expect(compareSemver('0.4.0-alpha', '0.4.0-beta')).toBe(-1)
  })

  it('a longer identifier list outranks a shared-prefix shorter one', () => {
    expect(compareSemver('0.4.0-alpha.1.1', '0.4.0-alpha.1')).toBe(1)
  })

  it('equal versions compare 0', () => {
    expect(compareSemver('0.4.0', '0.4.0')).toBe(0)
    expect(compareSemver('0.4.0-alpha.1', '0.4.0-alpha.1')).toBe(0)
  })

  it('accepts already-parsed objects too', () => {
    expect(compareSemver(parseSemver('1.0.0'), parseSemver('2.0.0'))).toBe(-1)
  })

  it('returns null (not a fabricated order) when either side is unparseable', () => {
    expect(compareSemver('not-a-version', '1.0.0')).toBeNull()
    expect(compareSemver('1.0.0', 'not-a-version')).toBeNull()
    expect(compareSemver('garbage', 'garbage')).toBeNull()
  })
})

function release(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: 'v1.0.0',
    draft: false,
    prerelease: false,
    name: 'Release',
    body: '',
    html_url: 'https://github.com/NehoraiHadad/hermes-business/releases/tag/v1.0.0',
    published_at: '2026-01-01T00:00:00Z',
    ...overrides
  }
}

describe('selectEligibleRelease — skip drafts, skip prereleases when current is stable', () => {
  it('picks the highest eligible release', () => {
    const releases = [release({ tag_name: 'v1.0.0' }), release({ tag_name: 'v1.2.0' }), release({ tag_name: 'v1.1.0' })]
    expect(selectEligibleRelease(releases, '0.9.0').tag_name).toBe('v1.2.0')
  })

  it('skips drafts entirely', () => {
    const releases = [release({ tag_name: 'v2.0.0', draft: true }), release({ tag_name: 'v1.0.0' })]
    expect(selectEligibleRelease(releases, '0.9.0').tag_name).toBe('v1.0.0')
  })

  it('skips prereleases when the current install is stable', () => {
    const releases = [release({ tag_name: 'v2.0.0-alpha.1', prerelease: true }), release({ tag_name: 'v1.0.0' })]
    expect(selectEligibleRelease(releases, '0.9.0').tag_name).toBe('v1.0.0')
  })

  it('an alpha/beta install compares against everything, including prereleases', () => {
    const releases = [release({ tag_name: 'v2.0.0-alpha.2', prerelease: true }), release({ tag_name: 'v1.0.0' })]
    expect(selectEligibleRelease(releases, '0.9.0-alpha.1').tag_name).toBe('v2.0.0-alpha.2')
  })

  it('skips an unparseable tag WITHOUT failing (just excluded)', () => {
    const releases = [release({ tag_name: 'not-a-version' }), release({ tag_name: 'v1.0.0' })]
    expect(selectEligibleRelease(releases, '0.9.0').tag_name).toBe('v1.0.0')
  })

  it('returns null when the list is empty', () => {
    expect(selectEligibleRelease([], '0.9.0')).toBeNull()
  })

  it('returns null when every tag is unparseable', () => {
    expect(selectEligibleRelease([release({ tag_name: 'garbage' }), release({ tag_name: 'also-garbage' })], '0.9.0')).toBeNull()
  })

  it('returns null for non-array input rather than throwing', () => {
    expect(selectEligibleRelease(null, '0.9.0')).toBeNull()
    expect(selectEligibleRelease(undefined, '0.9.0')).toBeNull()
    expect(selectEligibleRelease('not-an-array', '0.9.0')).toBeNull()
  })

  it('tolerates malformed entries in the list (null/non-object) without throwing', () => {
    expect(() => selectEligibleRelease([null, 42, 'x', release({ tag_name: 'v1.0.0' })], '0.9.0')).not.toThrow()
  })
})

describe('decideVerdict — exactly the four statuses; unknown is the default (§8)', () => {
  it('update-available: eligible newer than current', () => {
    const eligible = release({ tag_name: 'v2.0.0' })
    const v = decideVerdict('1.0.0', eligible)
    expect(v).toEqual({ status: 'update-available', release: eligible })
  })

  it('up-to-date: eligible equals current exactly', () => {
    expect(decideVerdict('1.0.0', release({ tag_name: 'v1.0.0' }))).toEqual({ status: 'up-to-date' })
  })

  it('dev-ahead: current is newer than anything eligible', () => {
    expect(decideVerdict('2.0.0', release({ tag_name: 'v1.0.0' }))).toEqual({ status: 'dev-ahead' })
  })

  it('unknown: no eligible release found (empty/all-filtered list) — empty is NOT proof of up-to-date', () => {
    expect(decideVerdict('1.0.0', null)).toEqual({ status: 'unknown' })
  })

  it('unknown: current itself is unparseable', () => {
    expect(decideVerdict('not-a-version', release())).toEqual({ status: 'unknown' })
  })

  it('unknown: the eligible release somehow carries an unparseable tag (defensive)', () => {
    expect(decideVerdict('1.0.0', release({ tag_name: 'garbage' }))).toEqual({ status: 'unknown' })
  })
})

describe('sanitizeReleaseNotes — plain text only, untrusted content (§6.1, R3)', () => {
  it('returns short text unchanged (trimmed)', () => {
    expect(sanitizeReleaseNotes('  Fixed a bug.  ')).toBe('Fixed a bug.')
  })

  it('strips Unicode bidi controls — an RTL UI must not be visually spoofable via RLO/isolates', () => {
    const bidi = '‮gnihton od‬ ⁦evil⁩ ‏‎؜'
    const out = sanitizeReleaseNotes(`safe ${bidi} text`)
    for (const ch of ['‪', '‫', '‬', '‭', '‮', '⁦', '⁧', '⁨', '⁩', '‎', '‏', '؜']) {
      expect(out).not.toContain(ch)
    }
    // The visible characters themselves survive — only the direction controls go.
    expect(out).toContain('gnihton od')
    expect(out).toContain('evil')
  })

  it('truncates to 600 characters', () => {
    const long = 'x'.repeat(1000)
    const out = sanitizeReleaseNotes(long)
    expect(out.length).toBe(600)
    expect(out).toBe('x'.repeat(600))
  })

  it('strips control characters (NUL, ESC, etc.) but keeps tab and newline for readability', () => {
    const withControls = `Line one\nLine\ttwo${String.fromCharCode(0)}${String.fromCharCode(27)}${String.fromCharCode(7)}`
    const out = sanitizeReleaseNotes(withControls)
    expect(out).toContain('\n')
    expect(out).toContain('\t')
    expect(out).not.toContain(String.fromCharCode(0))
    expect(out).not.toContain(String.fromCharCode(27))
    expect(out).not.toContain(String.fromCharCode(7))
  })

  it('is never interpreted as markdown/HTML — passes markdown syntax through as inert text', () => {
    const md = '# Heading\n**bold** <script>alert(1)</script> [link](javascript:alert(1))'
    expect(sanitizeReleaseNotes(md)).toBe(md)
  })

  it('returns empty string for non-string input', () => {
    expect(sanitizeReleaseNotes(null)).toBe('')
    expect(sanitizeReleaseNotes(undefined)).toBe('')
    expect(sanitizeReleaseNotes(42)).toBe('')
    expect(sanitizeReleaseNotes({ malicious: 'instructions' })).toBe('')
  })
})

describe('sanitizeDownloadUrl — exact prefix, no look-alike hosts (§6.3, R1)', () => {
  it('accepts a well-formed release/asset URL under the exact prefix', () => {
    const url = `${DOWNLOAD_URL_PREFIX}tag/v1.0.0`
    expect(sanitizeDownloadUrl(url)).toBe(url)
  })

  it('rejects an evil look-alike host (github.com.evil.tld)', () => {
    expect(sanitizeDownloadUrl('https://github.com.evil.tld/NehoraiHadad/hermes-business/releases/tag/v1.0.0')).toBeNull()
  })

  it('rejects a different owner/repo on the real host', () => {
    expect(sanitizeDownloadUrl('https://github.com/someone-else/other-repo/releases/tag/v1.0.0')).toBeNull()
  })

  it('rejects http (non-https) even on the right host', () => {
    expect(sanitizeDownloadUrl('http://github.com/NehoraiHadad/hermes-business/releases/tag/v1.0.0')).toBeNull()
  })

  it('rejects a URL that merely contains the prefix later in the string', () => {
    expect(sanitizeDownloadUrl(`https://evil.example/redirect?to=${DOWNLOAD_URL_PREFIX}`)).toBeNull()
  })

  it('rejects non-string input', () => {
    expect(sanitizeDownloadUrl(null)).toBeNull()
    expect(sanitizeDownloadUrl(undefined)).toBeNull()
    expect(sanitizeDownloadUrl(42)).toBeNull()
  })
})
