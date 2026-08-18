import { describe, expect, it } from 'vitest'
// @ts-expect-error - plain CJS module without type declarations
import {
  parseSemver,
  compareSemver,
  scanReleases,
  selectEligibleRelease,
  linkHeaderHasNextPage,
  isCompleteScan,
  decideVerdict,
  sanitizeReleaseNotes,
  sanitizeDownloadUrl,
  DOWNLOAD_URL_PREFIX
} from './companion-update-core.cjs'

// A scan that proved it saw everything AND actually read a census: no next
// page, nothing unorderable, at least one entry examined.
const COMPLETE = { truncated: false, examined: 3, undecided: 0 }

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

describe('scanReleases — separates DECISIVE exclusions from UNDECIDABLE ones', () => {
  it('reports the winning candidate alongside a zero undecided count on a clean listing', () => {
    const releases = [release({ tag_name: 'v1.0.0' }), release({ tag_name: 'v1.2.0' })]
    const scan = scanReleases(releases, '0.9.0')
    expect(scan.eligible.tag_name).toBe('v1.2.0')
    expect(scan.undecided).toBe(0)
  })

  it('a draft is DECISIVE (never published) — it does not make the scan incomplete, even with a garbage tag', () => {
    expect(scanReleases([release({ tag_name: 'garbage', draft: true })], '1.0.0').undecided).toBe(0)
  })

  it('a prerelease filtered out for a stable install is DECISIVE (channel policy D1), not undecided', () => {
    const releases = [
      release({ tag_name: 'v0.4.0-alpha.7', prerelease: true }),
      release({ tag_name: 'v0.4.0-alpha.8', prerelease: true })
    ]
    const scan = scanReleases(releases, '0.4.0')
    expect(scan.eligible).toBeNull()
    expect(scan.undecided).toBe(0)
  })

  it('a prerelease with a garbage tag is still policy-excluded for a stable install (not undecided)', () => {
    expect(scanReleases([release({ tag_name: 'nightly-build', prerelease: true })], '1.0.0').undecided).toBe(0)
  })

  it('an unparseable tag on a real published in-channel release IS undecided — it might be something newer', () => {
    const scan = scanReleases([release({ tag_name: 'garbage' }), release({ tag_name: 'v1.0.0' })], '0.9.0')
    expect(scan.eligible.tag_name).toBe('v1.0.0')
    expect(scan.undecided).toBe(1)
  })

  it('a non-object entry is undecided — the payload is not shaped like a release listing', () => {
    expect(scanReleases([null, 42, 'x'], '1.0.0').undecided).toBe(3)
  })

  it('an unparseable tag on a prerelease IS undecided when the install is itself a prerelease (no policy exclusion applies)', () => {
    expect(scanReleases([release({ tag_name: 'garbage', prerelease: true })], '1.0.0-alpha.1').undecided).toBe(1)
  })

  it('a non-array input yields no candidate and no fabricated counts', () => {
    expect(scanReleases(null, '1.0.0')).toEqual({ eligible: null, examined: 0, undecided: 0 })
  })

  it('reports how many entries were examined — an EMPTY census is a distinct fact from a filtered one', () => {
    expect(scanReleases([], '1.0.0')).toEqual({ eligible: null, examined: 0, undecided: 0 })
    // Same null candidate, but a real census WAS read: examined > 0.
    const filtered = scanReleases(
      [release({ tag_name: 'v0.4.0-alpha.8', prerelease: true }), release({ tag_name: 'v0.4.0-alpha.7', prerelease: true })],
      '0.4.0'
    )
    expect(filtered).toEqual({ eligible: null, examined: 2, undecided: 0 })
  })

  it('counts drafts and policy-excluded entries as examined — they were read and decisively ruled out', () => {
    expect(scanReleases([release({ draft: true }), release({ tag_name: 'v0.1.0' })], '1.0.0').examined).toBe(2)
  })
})

// The EXACT order `https://api.github.com/repos/NehoraiHadad/hermes-business/
// releases?per_page=20` returned on 2026-08-18, copied verbatim from the live
// response. Note where `v0.4.0-alpha.10` sits: THIRD, between alpha.8 and
// alpha.7 — even though it was, by every timestamp the API reports
// (created_at 14:32Z, published_at 14:34Z) and by release id (the highest of
// the nine), the newest release in the repo.
const LIVE_FEED_ORDER = [
  'v0.4.0-alpha.9',
  'v0.4.0-alpha.8',
  'v0.4.0-alpha.10',
  'v0.4.0-alpha.7',
  'v0.4.0-alpha.6',
  'v0.4.0-alpha.5',
  'v0.4.0-alpha.4',
  'v0.4.0-alpha.3',
  'v0.4.0-alpha.2'
]

const feed = (tags: string[]) => tags.map(tag_name => release({ tag_name, prerelease: true }))

describe('release-feed ORDER is not a signal — `releases[0]` is never the answer', () => {
  // WHY THIS EXISTS. Observed live on 2026-08-18 (see LIVE_FEED_ORDER above):
  // the GitHub releases feed does NOT come back newest-first. It is not ordered
  // by `published_at`, not by `created_at`, and not by release id — the three
  // fields a reader would reach for — and it is certainly not ordered by SemVer
  // precedence. `v0.4.0-alpha.10` came back in position 3, so a consumer that
  // trusted feed order and took `releases[0]` would have offered alpha.9 while
  // alpha.10 was already published.
  //
  // That failure is the dangerous kind: alpha.9 is a real, published, legally
  // named release of this product, so the app would show a plausible version
  // number, download a genuine signed installer, and pass every trust check —
  // it would simply be the WRONG version, forever, and nobody would notice.
  //
  // `scanReleases` is immune because it orders by SemVer precedence rather than
  // by position (see compareSemver). Nothing pinned that immunity on the app
  // side until now; `site/download-link.test.mjs` covers the site's own
  // `pickLatest`. Permutations below are FIXED, never shuffled at random —
  // a regression that only reproduces on some runs is a regression nobody fixes.
  it('picks alpha.10 out of the REAL feed order, where releases[0] is alpha.9', () => {
    const releases = feed(LIVE_FEED_ORDER)
    expect(releases[0].tag_name).toBe('v0.4.0-alpha.9') // the trap, stated out loud
    expect(selectEligibleRelease(releases, '0.4.0-alpha.8').tag_name).toBe('v0.4.0-alpha.10')
  })

  it('scanReleases reports the same winner, with a complete (zero-undecided) census', () => {
    const scan = scanReleases(feed(LIVE_FEED_ORDER), '0.4.0-alpha.8')
    expect(scan.eligible.tag_name).toBe('v0.4.0-alpha.10')
    expect(scan.examined).toBe(LIVE_FEED_ORDER.length)
    expect(scan.undecided).toBe(0)
  })

  it('the winner is invariant under every fixed permutation of the same nine releases', () => {
    const permutations: Record<string, string[]> = {
      'live order': LIVE_FEED_ORDER,
      reversed: [...LIVE_FEED_ORDER].reverse(),
      // alpha.10 first — the position that would mask an order-dependent bug.
      'winner first': ['v0.4.0-alpha.10', ...LIVE_FEED_ORDER.filter(t => t !== 'v0.4.0-alpha.10')],
      // alpha.10 last — the position that would expose one.
      'winner last': [...LIVE_FEED_ORDER.filter(t => t !== 'v0.4.0-alpha.10'), 'v0.4.0-alpha.10'],
      // Sorted ascending and descending as PLAIN STRINGS: exactly the two orders
      // a naive lexical sort would produce, and neither puts alpha.10 on top.
      'lexical ascending': [...LIVE_FEED_ORDER].sort(),
      'lexical descending': [...LIVE_FEED_ORDER].sort().reverse()
    }
    for (const [label, tags] of Object.entries(permutations)) {
      expect(tags.slice().sort()).toEqual(LIVE_FEED_ORDER.slice().sort()) // same nine, only reordered
      expect(selectEligibleRelease(feed(tags), '0.4.0-alpha.8').tag_name, label).toBe('v0.4.0-alpha.10')
    }
  })

  it('a lexical sort really would get it wrong — the trap is not hypothetical', () => {
    // Guards the guard: if `10` ever started sorting after `9` as a string, the
    // permutation test above would stop proving anything.
    expect([...LIVE_FEED_ORDER].sort().reverse()[0]).toBe('v0.4.0-alpha.9')
  })
})

describe('linkHeaderHasNextPage — the ONLY truncation signal (single request, no pagination)', () => {
  it('detects a quoted rel="next"', () => {
    const header =
      '<https://api.github.com/repositories/1/releases?per_page=20&page=2>; rel="next", ' +
      '<https://api.github.com/repositories/1/releases?per_page=20&page=3>; rel="last"'
    expect(linkHeaderHasNextPage(header)).toBe(true)
  })

  it('detects a bare rel=next and a space-separated rel list (RFC 8288)', () => {
    expect(linkHeaderHasNextPage('<https://api.github.com/x?page=2>; rel=next')).toBe(true)
    expect(linkHeaderHasNextPage('<https://api.github.com/x?page=2>; rel="prev next"')).toBe(true)
  })

  it('is false for a last/prev-only header (the final page of a paginated set)', () => {
    const header =
      '<https://api.github.com/repositories/1/releases?page=1>; rel="prev", ' +
      '<https://api.github.com/repositories/1/releases?page=1>; rel="first"'
    expect(linkHeaderHasNextPage(header)).toBe(false)
  })

  it('never mistakes a rel="next" substring INSIDE the URI for a real relation', () => {
    expect(linkHeaderHasNextPage('<https://evil.example/?x=rel%3D%22next%22&rel="next">; rel="last"')).toBe(false)
  })

  it('is false for an absent/blank/non-string header (the CALLER decides what unreadable means)', () => {
    expect(linkHeaderHasNextPage(null)).toBe(false)
    expect(linkHeaderHasNextPage(undefined)).toBe(false)
    expect(linkHeaderHasNextPage('')).toBe(false)
    expect(linkHeaderHasNextPage('   ')).toBe(false)
    expect(linkHeaderHasNextPage(42)).toBe(false)
  })

  it('never throws on hostile input', () => {
    expect(() => linkHeaderHasNextPage('<'.repeat(5000))).not.toThrow()
    expect(() => linkHeaderHasNextPage(',,,;;;rel=')).not.toThrow()
  })
})

describe('isCompleteScan — completeness needs positive proof on BOTH axes', () => {
  it('is true only for an untruncated scan with nothing left undecided', () => {
    expect(isCompleteScan({ truncated: false, undecided: 0 })).toBe(true)
  })

  it('says nothing about emptiness — an empty census IS complete (all zero entries were seen)', () => {
    expect(isCompleteScan({ truncated: false, examined: 0, undecided: 0 })).toBe(true)
  })

  it('is false when the listing was truncated', () => {
    expect(isCompleteScan({ truncated: true, undecided: 0 })).toBe(false)
  })

  it('is false when any entry could not be ordered', () => {
    expect(isCompleteScan({ truncated: false, undecided: 1 })).toBe(false)
  })

  it('a MISSING field is never proof — an absent/partial scan object is incomplete', () => {
    expect(isCompleteScan(undefined)).toBe(false)
    expect(isCompleteScan({})).toBe(false)
    expect(isCompleteScan({ undecided: 0 })).toBe(false)
    expect(isCompleteScan({ truncated: false })).toBe(false)
    // Truthy-but-not-`false` values must not sneak through a loose check.
    expect(isCompleteScan({ truncated: 'no', undecided: 0 })).toBe(false)
    expect(isCompleteScan({ truncated: 0, undecided: 0 })).toBe(false)
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

  it('unknown: no candidate and NO scan facts at all — a missing completeness proof is not a proof', () => {
    expect(decideVerdict('1.0.0', null)).toEqual({ status: 'unknown' })
  })

  it('unknown: current itself is unparseable', () => {
    expect(decideVerdict('not-a-version', release())).toEqual({ status: 'unknown' })
    // ...and it stays unknown even on a provably complete scan: without a
    // parseable running version there is nothing to compare against.
    expect(decideVerdict('not-a-version', null, COMPLETE)).toEqual({ status: 'unknown' })
  })

  it('unknown: the eligible release somehow carries an unparseable tag (defensive)', () => {
    expect(decideVerdict('1.0.0', release({ tag_name: 'garbage' }))).toEqual({ status: 'unknown' })
  })
})

describe('decideVerdict — a COMPLETE, NON-EMPTY scan with no candidate is a proof; an empty one is not', () => {
  it('up-to-date: complete NON-EMPTY scan, no eligible candidate (the stable-install / all-prerelease case)', () => {
    expect(decideVerdict('0.4.0', null, COMPLETE)).toEqual({ status: 'up-to-date' })
  })

  it('unknown: an EMPTY census is content-free — reading reassurance into [] is the fake-"מעודכן" of §1.4', () => {
    const scan = scanReleases([], '0.4.0')
    expect(scan.eligible).toBeNull()
    expect(scan.examined).toBe(0)
    // The scan IS complete — emptiness is not incompleteness — and it still
    // must not yield up-to-date: this repo publishes releases, so [] is an
    // upstream anomaly, and up-to-date would durably swallow a pending update.
    expect(isCompleteScan({ truncated: false, examined: scan.examined, undecided: scan.undecided })).toBe(true)
    expect(
      decideVerdict('0.4.0', scan.eligible, { truncated: false, examined: scan.examined, undecided: scan.undecided })
    ).toEqual({ status: 'unknown' })
  })

  it('unknown: TRUNCATED listing with no candidate — the unexamined page may hold the update', () => {
    expect(decideVerdict('0.4.0', null, { truncated: true, examined: 20, undecided: 0 })).toEqual({ status: 'unknown' })
  })

  it('unknown: untruncated listing whose tags were all unorderable — skipped is not "older"', () => {
    const scan = scanReleases([release({ tag_name: 'garbage' }), release({ tag_name: 'also-garbage' })], '1.0.0')
    expect(scan.eligible).toBeNull()
    expect(scan.undecided).toBe(2)
    expect(
      decideVerdict('1.0.0', scan.eligible, { truncated: false, examined: scan.examined, undecided: scan.undecided })
    ).toEqual({ status: 'unknown' })
  })

  it('the end-to-end stable-install case: 0.4.0 against a repo publishing only prereleases ⇒ up-to-date', () => {
    const releases = [
      release({ tag_name: 'v0.4.0-alpha.8', prerelease: true }),
      release({ tag_name: 'v0.4.0-alpha.7', prerelease: true }),
      release({ tag_name: 'v0.4.0-alpha.6', prerelease: true })
    ]
    const scan = scanReleases(releases, '0.4.0')
    expect(
      decideVerdict('0.4.0', scan.eligible, { truncated: false, examined: scan.examined, undecided: scan.undecided })
    ).toEqual({ status: 'up-to-date' })
    // The same listing for a prerelease install still resolves through the
    // normal comparison path — the fix must not disturb the alpha channel.
    const alphaScan = scanReleases(releases, '0.4.0-alpha.6')
    expect(
      decideVerdict('0.4.0-alpha.6', alphaScan.eligible, {
        truncated: false,
        examined: alphaScan.examined,
        undecided: alphaScan.undecided
      })
    ).toEqual({ status: 'update-available', release: alphaScan.eligible })
  })

  it('a found candidate stays decisive under truncation (all three comparison verdicts)', () => {
    const truncated = { truncated: true, examined: 20, undecided: 3 }
    expect(decideVerdict('1.0.0', release({ tag_name: 'v2.0.0' }), truncated).status).toBe('update-available')
    expect(decideVerdict('1.0.0', release({ tag_name: 'v1.0.0' }), truncated).status).toBe('up-to-date')
    expect(decideVerdict('2.0.0', release({ tag_name: 'v1.0.0' }), truncated).status).toBe('dev-ahead')
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
