import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  decidePublishedRelease,
  expectedAssetNames,
  expectedReleaseTitle,
  normalizeQuotedText,
  parseReleasingContract,
  parseSha256Sums
} from './published-release.mjs'

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const VERSION = '0.4.0-alpha.10'
const TAG = `v${VERSION}`
const INSTALLER = `Tachles-Setup-${VERSION}.exe`
const SHA = '4f50529746b285ac85e29b8e60695b811962d7532966ad3deb0e5d63e0d1daac'
const BYTES = 104336267

// The advisory exactly as docs/RELEASING.md carries it, hard-wrapped across four
// `> `-prefixed lines. Fixtures use the WRAPPED form on purpose — the whole point
// of the normalisation is that the doc's typesetting and the release page's
// single long line are the same text.
const ADVISORY_DOC_LINES = [
  '     > קובץ ההתקנה **אינו חתום דיגיטלית** (גרסת Pilot/Alpha — עדיין אין תעודת',
  '     > חתימה). Windows SmartScreen עשוי להציג אזהרה — זה צפוי. לפני ההתקנה,',
  '     > מומלץ לאמת את ה־SHA-256 של הקובץ מול `SHA256SUMS.txt` המצורף לאותה',
  '     > הוצאה.'
].join('\n')

/** A minimal but structurally faithful step 9 + step 10 boundary. */
function releasingDoc({
  step9Header = '9. **Create the GitHub Release — as a PRERELEASE.** Never publish before the',
  title = '--title "Tachles <version> (Alpha — Pilot)" `',
  assets = ['"release/Tachles-Setup-<version>.exe" `', '"release/SHA256SUMS.txt" `', '"release/update-manifest.json" `'],
  heading = '   - the Hebrew `### מה חדש (למשתמש)` section copied from `CHANGELOG.md`',
  advisory = ADVISORY_DOC_LINES
} = {}) {
  return [
    '8. **Sign the update manifest.**',
    '   - Upload it as a release asset alongside `SHA256SUMS.txt` in the next step.',
    '',
    step9Header,
    '   pipeline in step 5 succeeded.',
    '',
    '   ```powershell',
    '   gh release create v<version> `',
    ...assets.map(a => `     ${a}`),
    `     ${title}`,
    '     --prerelease `',
    '     --notes-file <path>',
    '   ```',
    '',
    heading,
    '   - a fixed installation advisory (copy verbatim, do not paraphrase away the',
    '     honesty):',
    '',
    advisory,
    '',
    '10. **Populate the version-immutability ledger — BOTH files.**',
    '    ```json',
    '    { "source": "github-asset" }',
    '    ```'
  ].join('\n')
}

const CONTRACT = parseReleasingContract(releasingDoc())

const MANIFEST_DOC = {
  schema: 1,
  version: VERSION,
  channel: 'pilot',
  installer: { name: INSTALLER, sha256: SHA, bytes: BYTES },
  released_at: '2026-08-18',
  signed_by: 'tachles-update-ed25519-947e2bb83d384c67',
  signature: 'ZmFrZS1zaWduYXR1cmU='
}
const MANIFEST_TEXT = `${JSON.stringify(MANIFEST_DOC, null, 2)}\n`

const BODY = [
  '**Tachles** is a Hebrew-first desktop assistant for small businesses in Israel.',
  '',
  `**Otherwise:** download \`${INSTALLER}\` below and run it.`,
  '',
  'The release notes below are in Hebrew, for pilot testers.',
  '',
  '---',
  '',
  '### מה חדש (למשתמש)',
  '',
  '- **אפשר לחזור לגרסה הקודמת.**',
  '',
  '---',
  '',
  `> ${CONTRACT.advisory}`,
  ''
].join('\n')

/** The all-green publish, as v0.4.0-alpha.10 looks today. Every failure test
 * below is this object with exactly ONE thing changed, so a code that fires can
 * only have fired because of that change. */
function goodInput(overrides = {}) {
  return {
    channel: 'pilot',
    tag: TAG,
    packageVersion: VERSION,
    release: {
      tagName: TAG,
      name: `Tachles ${VERSION} (Alpha — Pilot)`,
      body: BODY,
      draft: false,
      prerelease: true,
      assets: [
        { name: 'SHA256SUMS.txt', size: 113 },
        { name: INSTALLER, size: BYTES, digest: `sha256:${SHA}` },
        { name: 'update-manifest.json', size: MANIFEST_TEXT.length }
      ]
    },
    contract: CONTRACT,
    checksums: { generated_from: 'release/', installers: [{ name: INSTALLER, bytes: BYTES, sha256: SHA }] },
    sha256sumsText: `${SHA}     ${BYTES}  ${INSTALLER}\n`,
    ledger: { source: 'github-asset', entries: { [VERSION]: { sha256: SHA, released_at: '2026-08-18' } } },
    localManifestText: MANIFEST_TEXT,
    publishedManifestText: MANIFEST_TEXT,
    verifyManifest: () => ({ ok: true, detail: 'authenticated (stub)' }),
    ...overrides
  }
}

/** Codes only — the prose detail is for humans, the code is the contract. */
function codes(result) {
  return result.failures.map(f => f.code)
}

// ---------------------------------------------------------------------------

describe('parseReleasingContract — the checklist IS the specification', () => {
  it('parses the REAL docs/RELEASING.md step 9 with zero errors', () => {
    // This is the load-bearing test: if the doc is reworded so the parser can no
    // longer find the title/assets/heading/advisory, THIS fails loudly instead of
    // the verifier quietly checking nothing.
    const real = parseReleasingContract(readFileSync(path.join(ROOT, 'docs', 'RELEASING.md'), 'utf8'))
    expect(real.errors).toEqual([])
    expect(real.titleTemplate).toBe('Tachles <version> (Alpha — Pilot)')
    expect(real.assetNames).toEqual(['Tachles-Setup-<version>.exe', 'SHA256SUMS.txt', 'update-manifest.json'])
    expect(real.changelogHeading).toBe('### מה חדש (למשתמש)')
    expect(real.advisory).toContain('אינו חתום דיגיטלית')
    expect(real.advisory).toContain('`SHA256SUMS.txt`')
  })

  it('the fixture doc parses identically to the real one (so the fixtures are honest)', () => {
    const real = parseReleasingContract(readFileSync(path.join(ROOT, 'docs', 'RELEASING.md'), 'utf8'))
    expect(CONTRACT.titleTemplate).toBe(real.titleTemplate)
    expect(CONTRACT.assetNames).toEqual(real.assetNames)
    expect(CONTRACT.changelogHeading).toBe(real.changelogHeading)
    expect(CONTRACT.advisory).toBe(real.advisory)
  })

  it('an unlocatable step 9 is a refusal, not a relaxation — every field is null', () => {
    const r = parseReleasingContract('# some other document\n\nnothing to see here\n')
    expect(r.titleTemplate).toBeNull()
    expect(r.assetNames).toBeNull()
    expect(r.changelogHeading).toBeNull()
    expect(r.advisory).toBeNull()
    expect(r.errors).toHaveLength(1)
  })

  it('reports a missing --title argument', () => {
    const r = parseReleasingContract(releasingDoc({ title: '--prerelease `' }))
    expect(r.titleTemplate).toBeNull()
    expect(r.errors.join(' ')).toContain('--title')
  })

  it('reports a --title template with no <version> placeholder', () => {
    const r = parseReleasingContract(releasingDoc({ title: '--title "Tachles (Alpha — Pilot)" `' }))
    expect(r.errors.join(' ')).toContain('<version> placeholder')
  })

  it('reports the wrong number of release/<asset> arguments', () => {
    const r = parseReleasingContract(releasingDoc({ assets: ['"release/SHA256SUMS.txt" `'] }))
    expect(r.errors.join(' ')).toContain('found 1')
  })

  it('reports a missing Hebrew section heading', () => {
    const r = parseReleasingContract(releasingDoc({ heading: '   - the Hebrew section copied from CHANGELOG.md' }))
    expect(r.changelogHeading).toBeNull()
    expect(r.errors.join(' ')).toContain('heading')
  })

  it('reports a missing blockquote advisory', () => {
    const r = parseReleasingContract(releasingDoc({ advisory: '     (the advisory used to be here)' }))
    expect(r.advisory).toBeNull()
    expect(r.errors.join(' ')).toContain('advisory')
  })

  it('takes the LAST blockquote, so a quote added above it cannot become "the advisory"', () => {
    const r = parseReleasingContract(releasingDoc({ advisory: `     > an explanatory aside\n\n${ADVISORY_DOC_LINES}` }))
    expect(r.advisory).toBe(CONTRACT.advisory)
    expect(r.advisory).not.toContain('explanatory aside')
  })

  it('does not read step 10 as step 9 (the slice really is bounded)', () => {
    // Step 10 in the fixture carries its own ```json fence; nothing from it may
    // leak into the parsed asset list.
    expect(CONTRACT.assetNames).toHaveLength(3)
  })
})

describe('normalizeQuotedText — typesetting is not content', () => {
  it('strips blockquote markers and collapses hard wrapping', () => {
    expect(normalizeQuotedText('> one\n> two\n>   three')).toBe('one two three')
  })

  it('preserves the maqaf, the em dash, emphasis and the code span (the un-paraphrasable parts)', () => {
    const n = normalizeQuotedText(ADVISORY_DOC_LINES)
    expect(n).toContain('**אינו חתום דיגיטלית**')
    expect(n).toContain('ה־SHA-256')
    expect(n).toContain('`SHA256SUMS.txt`')
    expect(n).toContain('—')
  })

  it('is null/undefined safe', () => {
    expect(normalizeQuotedText(null)).toBe('')
    expect(normalizeQuotedText(undefined)).toBe('')
  })
})

describe('expectedReleaseTitle / expectedAssetNames — substitution', () => {
  it('substitutes every <version> occurrence', () => {
    expect(expectedReleaseTitle('Tachles <version> (Alpha — Pilot)', VERSION)).toBe(`Tachles ${VERSION} (Alpha — Pilot)`)
    expect(expectedAssetNames(['Tachles-Setup-<version>.exe', 'SHA256SUMS.txt'], VERSION)).toEqual([INSTALLER, 'SHA256SUMS.txt'])
  })

  it('returns null when either half is missing rather than emitting a half-substituted expectation', () => {
    expect(expectedReleaseTitle(null, VERSION)).toBeNull()
    expect(expectedReleaseTitle('Tachles <version>', null)).toBeNull()
    expect(expectedAssetNames(null, VERSION)).toBeNull()
    expect(expectedAssetNames(['x'], null)).toBeNull()
  })
})

describe('parseSha256Sums', () => {
  it('parses the `sha256  bytes  name` table gen-installer-checksums.mjs writes', () => {
    expect(parseSha256Sums(`${SHA}     ${BYTES}  ${INSTALLER}\n`)).toEqual([{ sha256: SHA, bytes: BYTES, name: INSTALLER }])
  })

  it('ignores lines that are not a full sha256/size/name triple, and never throws', () => {
    expect(parseSha256Sums('# a comment\nnot a checksum line\n')).toEqual([])
    expect(parseSha256Sums(null)).toEqual([])
    expect(parseSha256Sums(undefined)).toEqual([])
  })
})

// ---------------------------------------------------------------------------

describe('decidePublishedRelease — the all-green publish', () => {
  it('passes with zero failures', () => {
    const r = decidePublishedRelease(goodInput())
    expect(r.failures).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.version).toBe(VERSION)
  })

  it('accepts an advisory the release page carries on ONE line where the doc wraps it over four', () => {
    // Regression guard for the normalisation itself: the doc's line breaks must
    // never be the reason a correct release fails.
    const r = decidePublishedRelease(goodInput({
      release: { ...goodInput().release, body: BODY.replace(`> ${CONTRACT.advisory}`, ADVISORY_DOC_LINES) }
    }))
    expect(codes(r)).not.toContain('body-advisory-missing')
  })

  it('rejects an unknown channel outright rather than granting it the lenient branch', () => {
    expect(() => decidePublishedRelease(goodInput({ channel: 'prod' }))).toThrow(/unknown release channel/)
  })
})

describe('decidePublishedRelease — 1. existence, draft, prerelease flag', () => {
  it('a release that could not be read is a failure, and short-circuits (nothing downstream is invented)', () => {
    const r = decidePublishedRelease(goodInput({ release: null }))
    expect(codes(r)).toEqual(['release-absent'])
    expect(r.ok).toBe(false)
  })

  it('a DRAFT release fails — its assets are not public', () => {
    const r = decidePublishedRelease(goodInput({ release: { ...goodInput().release, draft: true } }))
    expect(codes(r)).toContain('release-draft')
  })

  it('an absent draft flag is treated as unproven, not as false', () => {
    const { draft, ...noDraft } = goodInput().release
    expect(draft).toBe(false)
    expect(codes(decidePublishedRelease(goodInput({ release: noDraft })))).toContain('release-draft')
  })

  it('pilot REQUIRES prerelease=true', () => {
    const r = decidePublishedRelease(goodInput({ release: { ...goodInput().release, prerelease: false } }))
    expect(codes(r)).toContain('prerelease-flag-wrong')
  })

  it('public REQUIRES prerelease=false — the same field, the opposite expectation', () => {
    expect(codes(decidePublishedRelease(goodInput({ channel: 'public' })))).toContain('prerelease-flag-wrong')
    const r = decidePublishedRelease(goodInput({ channel: 'public', release: { ...goodInput().release, prerelease: false } }))
    expect(codes(r)).not.toContain('prerelease-flag-wrong')
  })

  it('qa is never distributed — a published qa release is itself the defect', () => {
    expect(codes(decidePublishedRelease(goodInput({ channel: 'qa' })))).toContain('channel-not-publishable')
  })

  it('a release whose own tag_name differs from the tag under test fails', () => {
    const r = decidePublishedRelease(goodInput({ release: { ...goodInput().release, tagName: 'v0.4.0-alpha.9' } }))
    expect(codes(r)).toContain('release-tag-mismatch')
  })
})

describe('decidePublishedRelease — 2. the tag names package.json version (decideVersionTag, reused)', () => {
  it('a tag naming a DIFFERENT version fails', () => {
    const r = decidePublishedRelease(goodInput({ tag: 'v0.4.0-alpha.9', release: { ...goodInput().release, tagName: 'v0.4.0-alpha.9' } }))
    expect(codes(r)).toContain('version-mismatch')
  })

  it('a malformed tag fails with the shared code, and no version is claimed', () => {
    const r = decidePublishedRelease(goodInput({ tag: 'release-0.4.0' }))
    expect(codes(r)).toContain('tag-not-semver')
    expect(r.version).toBeNull()
  })

  it('an absent package.json version fails rather than matching anything', () => {
    expect(codes(decidePublishedRelease(goodInput({ packageVersion: null })))).toContain('package-version-missing')
  })
})

describe('decidePublishedRelease — the specification itself must be readable', () => {
  it('an unparseable docs/RELEASING.md is a failure, and the checks it drives do not silently pass', () => {
    const r = decidePublishedRelease(goodInput({ contract: parseReleasingContract('nothing here') }))
    expect(codes(r)).toContain('releasing-doc-unreadable')
    expect(r.ok).toBe(false)
  })

  it('a MISSING contract (doc unreadable on disk) is a failure too', () => {
    const r = decidePublishedRelease(goodInput({ contract: null }))
    expect(codes(r)).toContain('releasing-doc-unreadable')
  })
})

describe('decidePublishedRelease — 3. EXACTLY the three required assets', () => {
  it('reproduces the REAL v0.4.0-alpha.10 mistake: checksums.json uploaded instead of SHA256SUMS.txt', () => {
    // Missing and extra are DIFFERENT mistakes and must be reported separately —
    // the missing file is the one the advisory tells users to verify against, the
    // extra one is an unmandated file inviting them to verify against the wrong
    // thing.
    const assets = goodInput().release.assets
      .filter(a => a.name !== 'SHA256SUMS.txt')
      .concat([{ name: 'checksums.json', size: 200 }])
    const r = decidePublishedRelease(goodInput({ release: { ...goodInput().release, assets } }))
    expect(codes(r)).toContain('asset-missing')
    expect(codes(r)).toContain('asset-unexpected')
    expect(r.failures.find(f => f.code === 'asset-missing').detail).toContain('SHA256SUMS.txt')
    expect(r.failures.find(f => f.code === 'asset-unexpected').detail).toContain('checksums.json')
  })

  it('a missing installer asset is reported as missing, not as a checksum problem', () => {
    const assets = goodInput().release.assets.filter(a => a.name !== INSTALLER)
    const r = decidePublishedRelease(goodInput({ release: { ...goodInput().release, assets } }))
    expect(codes(r)).toContain('asset-missing')
    expect(codes(r)).not.toContain('installer-size-mismatch')
  })

  it('an EXTRA asset alongside all three required ones still fails', () => {
    const assets = goodInput().release.assets.concat([{ name: 'latest.yml', size: 10 }])
    expect(codes(decidePublishedRelease(goodInput({ release: { ...goodInput().release, assets } })))).toContain('asset-unexpected')
  })

  it('a doc whose installer name has drifted from the PINNED artifact name fails on that, not on the assets', () => {
    const drifted = parseReleasingContract(releasingDoc({
      assets: ['"release/Tachles Setup <version>.exe" `', '"release/SHA256SUMS.txt" `', '"release/update-manifest.json" `']
    }))
    const r = decidePublishedRelease(goodInput({ contract: drifted }))
    expect(codes(r)).toContain('doc-installer-name-drift')
  })
})

describe('decidePublishedRelease — 4. the documented Latin-script title', () => {
  it('reproduces the REAL v0.4.0-alpha.10 mistake: a Hebrew title', () => {
    const r = decidePublishedRelease(goodInput({ release: { ...goodInput().release, name: `תכל'ס ${VERSION} (אלפא — פיילוט)` } }))
    expect(codes(r)).toContain('title-mismatch')
  })

  it('a title with the wrong version fails even though the shape is right', () => {
    const r = decidePublishedRelease(goodInput({ release: { ...goodInput().release, name: 'Tachles 0.4.0-alpha.9 (Alpha — Pilot)' } }))
    expect(codes(r)).toContain('title-mismatch')
  })

  it('an absent title fails', () => {
    const r = decidePublishedRelease(goodInput({ release: { ...goodInput().release, name: null } }))
    expect(codes(r)).toContain('title-mismatch')
  })
})

describe('decidePublishedRelease — 5. the bilingual body', () => {
  it('an empty body fails — the in-app update panel renders this text', () => {
    const r = decidePublishedRelease(goodInput({ release: { ...goodInput().release, body: '   \n' } }))
    expect(codes(r)).toContain('body-absent')
  })

  it('a body missing the Hebrew CHANGELOG section fails', () => {
    const body = BODY.replace('### מה חדש (למשתמש)', '### What is new')
    const r = decidePublishedRelease(goodInput({ release: { ...goodInput().release, body } }))
    expect(codes(r)).toContain('body-changelog-heading-missing')
  })

  it('a PARAPHRASED advisory fails — step 9 says copy it verbatim', () => {
    const body = BODY.replace(`> ${CONTRACT.advisory}`, '> הקובץ לא חתום. ייתכן ש-SmartScreen יזהיר.')
    const r = decidePublishedRelease(goodInput({ release: { ...goodInput().release, body } }))
    expect(codes(r)).toContain('body-advisory-missing')
  })

  it('an advisory with the SHA256SUMS.txt reference dropped fails (that is the whole promise)', () => {
    const body = BODY.replace('`SHA256SUMS.txt`', '`checksums.json`')
    const r = decidePublishedRelease(goodInput({ release: { ...goodInput().release, body } }))
    expect(codes(r)).toContain('body-advisory-missing')
  })

  it('a body with no advisory at all fails', () => {
    const body = BODY.split('\n').filter(l => !l.startsWith('> ')).join('\n')
    expect(codes(decidePublishedRelease(goodInput({ release: { ...goodInput().release, body } })))).toContain('body-advisory-missing')
  })
})

describe('decidePublishedRelease — 6. published installer bound to checksums / SHA256SUMS / ledger', () => {
  it('a published asset SIZE that disagrees with checksums.json fails', () => {
    const assets = goodInput().release.assets.map(a => (a.name === INSTALLER ? { ...a, size: BYTES - 1 } : a))
    expect(codes(decidePublishedRelease(goodInput({ release: { ...goodInput().release, assets } })))).toContain('installer-size-mismatch')
  })

  it('a published asset DIGEST that disagrees with checksums.json fails', () => {
    const assets = goodInput().release.assets.map(a => (a.name === INSTALLER ? { ...a, digest: `sha256:${'0'.repeat(64)}` } : a))
    expect(codes(decidePublishedRelease(goodInput({ release: { ...goodInput().release, assets } })))).toContain('installer-digest-mismatch')
  })

  it('when GitHub offers NO digest the bytes are bound by size only — and that limitation is stated, not hidden', () => {
    const assets = goodInput().release.assets.map(a => (a.name === INSTALLER ? { name: a.name, size: a.size } : a))
    const r = decidePublishedRelease(goodInput({ release: { ...goodInput().release, assets } }))
    expect(r.ok).toBe(true)
    expect(r.notes.join(' ')).toContain('SIZE only')
  })

  it('an unreadable checksums.json fails', () => {
    expect(codes(decidePublishedRelease(goodInput({ checksums: null })))).toContain('checksums-unreadable')
  })

  it('a checksums.json with no entry for this installer fails', () => {
    const r = decidePublishedRelease(goodInput({ checksums: { installers: [{ name: 'other.exe', bytes: 1, sha256: SHA }] } }))
    expect(codes(r)).toContain('checksums-entry-absent')
  })

  it('an unreadable SHA256SUMS.txt fails — it is the file the advisory points users at', () => {
    expect(codes(decidePublishedRelease(goodInput({ sha256sumsText: null })))).toContain('sha256sums-unreadable')
  })

  it('a SHA256SUMS.txt with no line for this installer fails', () => {
    const r = decidePublishedRelease(goodInput({ sha256sumsText: `${SHA}     ${BYTES}  other.exe\n` }))
    expect(codes(r)).toContain('sha256sums-entry-absent')
  })

  it('SHA256SUMS.txt disagreeing with checksums.json on the DIGEST fails', () => {
    const r = decidePublishedRelease(goodInput({ sha256sumsText: `${'a'.repeat(64)}     ${BYTES}  ${INSTALLER}\n` }))
    expect(codes(r)).toContain('sha256sums-digest-disagrees')
  })

  it('SHA256SUMS.txt disagreeing with checksums.json on the SIZE fails', () => {
    const r = decidePublishedRelease(goodInput({ sha256sumsText: `${SHA}     ${BYTES - 1}  ${INSTALLER}\n` }))
    expect(codes(r)).toContain('sha256sums-bytes-disagrees')
  })

  it('an unreadable release-ledger.json fails', () => {
    expect(codes(decidePublishedRelease(goodInput({ ledger: null })))).toContain('ledger-unreadable')
  })

  it('a ledger with no entry for a version that is ALREADY published fails (step 10 was skipped)', () => {
    const r = decidePublishedRelease(goodInput({ ledger: { source: 'github-asset', entries: {} } }))
    expect(codes(r)).toContain('ledger-entry-absent')
  })

  it('a ledger entry whose digest contradicts the manifest fails via the shared cross-check', () => {
    const ledger = { source: 'github-asset', entries: { [VERSION]: { sha256: 'b'.repeat(64) } } }
    expect(codes(decidePublishedRelease(goodInput({ ledger })))).toContain('manifest-crosscheck-ledger-digest-mismatch')
  })
})

describe('decidePublishedRelease — 7. the PUBLISHED signed manifest', () => {
  it('an undownloadable manifest asset is a failure, never an assumption', () => {
    const r = decidePublishedRelease(goodInput({ publishedManifestText: null }))
    expect(codes(r)).toContain('published-manifest-unavailable')
  })

  it('an unreadable LOCAL manifest is a failure too (nothing to compare against)', () => {
    expect(codes(decidePublishedRelease(goodInput({ localManifestText: null })))).toContain('local-manifest-unreadable')
  })

  it('published bytes that differ from release/update-manifest.json fail, even by whitespace', () => {
    const r = decidePublishedRelease(goodInput({ publishedManifestText: `${MANIFEST_TEXT} ` }))
    expect(codes(r)).toContain('manifest-bytes-differ')
  })

  it('a published manifest that is not JSON fails', () => {
    const r = decidePublishedRelease(goodInput({ localManifestText: 'not json', publishedManifestText: 'not json' }))
    expect(codes(r)).toContain('published-manifest-unparseable')
  })

  it('a manifest whose signature does not verify fails with the verifier own code', () => {
    const r = decidePublishedRelease(goodInput({
      verifyManifest: () => ({ ok: false, code: 'signature-invalid', detail: 'forged/tampered' })
    }))
    expect(codes(r)).toContain('manifest-signature-invalid')
  })

  it('an unknown signer fails with its own code (so the two are distinguishable)', () => {
    const r = decidePublishedRelease(goodInput({
      verifyManifest: () => ({ ok: false, code: 'signer-unknown', detail: 'not a trusted key' })
    }))
    expect(codes(r)).toContain('manifest-signer-unknown')
  })

  it('NO injected verifier means unverified — never "assumed signed"', () => {
    const r = decidePublishedRelease(goodInput({ verifyManifest: null }))
    expect(codes(r)).toContain('manifest-verifier-absent')
  })

  it('a manifest whose installer digest contradicts checksums.json fails the shared cross-check', () => {
    const doc = { ...MANIFEST_DOC, installer: { ...MANIFEST_DOC.installer, sha256: 'c'.repeat(64) } }
    const text = `${JSON.stringify(doc, null, 2)}\n`
    const r = decidePublishedRelease(goodInput({ localManifestText: text, publishedManifestText: text }))
    expect(codes(r)).toContain('manifest-crosscheck-checksums-digest-mismatch')
  })
})
