// Read-only verifier for the ONE manual step of a release: the GitHub Release
// itself (docs/RELEASING.md step 9).
//
//   node scripts/verify-published-release.mjs --tag v<version> [--channel pilot]
//
// Everything else in this pipeline is machine-verified — the artifact set, the
// checksums, the installer↔payload binding, the signing phase, the ledger, the
// evidence envelopes, the git tag. Publishing is the last hand-driven action,
// performed from a prose checklist, and it is therefore the only place a release
// can be wrong while every gate stays green. Publishing v0.4.0-alpha.10 drifted
// from that checklist within minutes of it being read (Hebrew title,
// `checksums.json` uploaded in place of `SHA256SUMS.txt`, a Hebrew-only body);
// nothing in the pipeline noticed. This closes that loop.
//
// Checks, all fail-closed (anything unverifiable is a FAILURE, never a pass):
//   1. the release exists, is published (not a draft) and carries the channel's
//      prerelease flag;
//   2. the tag names the version package.json carries (decideVersionTag —
//      scripts/verify-version-tag.mjs's own decision module, not a second copy);
//   3. the asset set is EXACTLY the three step 9 uploads (missing and extra are
//      reported separately — they are different mistakes);
//   4. the title matches step 9's Latin-script `--title` template;
//   5. the body carries the Hebrew CHANGELOG section AND the verbatim
//      installation advisory;
//   6. the published installer's size (and, when GitHub offers it, its digest)
//      agrees with release/checksums.json, SHA256SUMS.txt and release-ledger.json;
//   7. the published update-manifest.json asset, DOWNLOADED, is byte-identical
//      to release/update-manifest.json and its signature verifies against the
//      SHIPPED trust keys (electron/update-trust.cjs + the one runtime verifier
//      in electron/update-manifest-verify.cjs — never a second implementation).
//
// The expected title/assets/heading/advisory are PARSED out of docs/RELEASING.md
// rather than restated here; see scripts/lib/published-release.mjs for why a
// second copy would be worse than no check at all.
//
// Mutates NOTHING in the repo: no git write, no release edit, no file write
// (the one downloaded asset lands in the OS temp directory and is removed).

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { repoRoot } from './lib/source-fingerprint.mjs'
import { parseChannel } from './lib/parse-channel.mjs'
import { requireElectron } from './lib/electron-require.mjs'
import { verifyUpdateManifest } from './lib/release/update-manifest.mjs'
import { decidePublishedRelease, parseReleasingContract } from './lib/published-release.mjs'

const MANIFEST_ASSET = 'update-manifest.json'

/** The repo the app's own updater reads its release feed from — DERIVED from
 * electron/companion-update.cjs's RELEASES_URL, never retyped. A verifier that
 * inspected a different repo than the one users update from would be worse than
 * useless, and that is precisely the kind of drift a second literal invites. */
function releaseRepoSlug() {
  const { RELEASES_URL } = requireElectron('companion-update.cjs')
  const m = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/releases/.exec(String(RELEASES_URL || ''))
  if (!m) throw new Error(`cannot derive the release repo from RELEASES_URL ${JSON.stringify(RELEASES_URL)}`)
  return m[1]
}

/** Read a file, or null when it is absent/unreadable. Null is never "fine" —
 * every caller turns it into a failure; it exists so ONE unreadable input does
 * not abort the rest of the report. */
function readOrNull(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function readJsonOrNull(file) {
  const text = readOrNull(file)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Network. `gh` first (the CLI docs/RELEASING.md publishes with, already
// authenticated, and the only door that works on a private/rate-limited repo);
// plain `fetch` as the fallback when gh is not installed.
// ---------------------------------------------------------------------------

class GithubUnavailable extends Error {
  constructor(message, { rateLimited = false } = {}) {
    super(message)
    this.name = 'GithubUnavailable'
    this.rateLimited = rateLimited
  }
}

function ghAvailable() {
  try {
    execFileSync('gh', ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] })
    return true
  } catch {
    return false
  }
}

/** A 403 from GitHub is almost always the unauthenticated rate limit, and its
 * raw shape ("HTTP 403") reads like a permissions failure — which would send an
 * operator hunting for the wrong problem. Name it honestly instead. */
function isRateLimited(text) {
  return /rate limit|API rate limit exceeded|403/i.test(String(text || ''))
}

function ghReleaseView(tag, slug) {
  try {
    const out = execFileSync(
      'gh',
      ['release', 'view', tag, '--repo', slug, '--json', 'tagName,name,body,isDraft,isPrerelease,assets'],
      { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }
    )
    const raw = JSON.parse(out)
    return {
      tagName: raw.tagName,
      name: raw.name,
      body: raw.body,
      draft: raw.isDraft,
      prerelease: raw.isPrerelease,
      assets: (raw.assets || []).map(a => ({ name: a.name, size: a.size, digest: a.digest, url: a.url }))
    }
  } catch (e) {
    const stderr = e?.stderr ? String(e.stderr) : e?.message || ''
    if (isRateLimited(stderr)) {
      throw new GithubUnavailable(`GitHub refused the request (rate limit / 403): ${stderr.trim()}`, { rateLimited: true })
    }
    if (/release not found|Not Found|HTTP 404/i.test(stderr)) return null
    throw new GithubUnavailable(`gh release view ${tag} failed: ${stderr.trim()}`)
  }
}

async function fetchReleaseByTag(tag, slug) {
  const res = await fetch(`https://api.github.com/repos/${slug}/releases/tags/${encodeURIComponent(tag)}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'tachles-verify-published-release' }
  })
  if (res.status === 404) return null
  if (res.status === 403 || res.status === 429) {
    throw new GithubUnavailable(
      `GitHub returned ${res.status} for the release feed — this is the UNAUTHENTICATED rate limit, not a permissions problem. Install/authenticate the gh CLI (\`gh auth login\`) and re-run; this tool prefers gh precisely to avoid it.`,
      { rateLimited: true }
    )
  }
  if (!res.ok) throw new GithubUnavailable(`GitHub returned HTTP ${res.status} for ${tag}`)
  const raw = await res.json()
  return {
    tagName: raw.tag_name,
    name: raw.name,
    body: raw.body,
    draft: raw.draft,
    prerelease: raw.prerelease,
    assets: (raw.assets || []).map(a => ({ name: a.name, size: a.size, digest: a.digest, url: a.browser_download_url }))
  }
}

/** Download ONE released asset's bytes as text, or null when it cannot be had.
 * gh writes it into a temp directory that is removed straight after; the repo
 * working tree is never touched. */
function ghDownloadAsset(tag, slug, assetName) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tachles-published-'))
  try {
    execFileSync('gh', ['release', 'download', tag, '--repo', slug, '--pattern', assetName, '--dir', dir, '--clobber'], {
      stdio: ['ignore', 'ignore', 'pipe']
    })
    return readOrNull(path.join(dir, assetName))
  } catch {
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function fetchAssetText(release, assetName) {
  const asset = (release.assets || []).find(a => a.name === assetName)
  if (!asset?.url) return null
  try {
    const res = await fetch(asset.url, {
      headers: { accept: 'application/octet-stream', 'user-agent': 'tachles-verify-published-release' }
    })
    return res.ok ? await res.text() : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------

export async function verifyPublishedRelease({ tag, channel = 'pilot', root = repoRoot() } = {}) {
  const slug = releaseRepoSlug()
  const useGh = ghAvailable()

  const release = useGh ? ghReleaseView(tag, slug) : await fetchReleaseByTag(tag, slug)
  const publishedManifestText = release
    ? (useGh ? ghDownloadAsset(tag, slug, MANIFEST_ASSET) : await fetchAssetText(release, MANIFEST_ASSET))
    : null

  const releasingDoc = readOrNull(path.join(root, 'docs', 'RELEASING.md'))
  const contract = releasingDoc === null
    ? { titleTemplate: null, assetNames: null, changelogHeading: null, advisory: null, errors: ['file could not be read'] }
    : parseReleasingContract(releasingDoc)

  const verdict = decidePublishedRelease({
    channel,
    tag,
    packageVersion: readJsonOrNull(path.join(root, 'package.json'))?.version || null,
    release,
    contract,
    checksums: readJsonOrNull(path.join(root, 'release', 'checksums.json')),
    sha256sumsText: readOrNull(path.join(root, 'release', 'SHA256SUMS.txt')),
    ledger: readJsonOrNull(path.join(root, 'release-ledger.json')),
    localManifestText: readOrNull(path.join(root, 'release', 'update-manifest.json')),
    publishedManifestText,
    // The SHIPPED verifier and the SHIPPED key map, injected — not a build-time
    // re-implementation. `currentVersion: '0.0.0'` + direction 'forward' is the
    // same convention signUpdateManifest() uses to self-check a freshly signed
    // manifest: we are asserting the document is authentic and describes THIS
    // version, not simulating a particular install's upgrade decision.
    verifyManifest: ({ manifest, expectedVersion }) => verifyUpdateManifest({
      manifest,
      currentVersion: '0.0.0',
      expectedVersion,
      direction: 'forward',
      keys: requireElectron('update-trust.cjs').UPDATE_TRUST_KEYS,
      verifySignature: requireElectron('update-trust.cjs').verifyManifestSignature
    })
  })

  return { ...verdict, tag, channel, slug, source: useGh ? 'gh CLI' : 'api.github.com (unauthenticated fetch)' }
}

function parseArgs(argv) {
  const i = argv.indexOf('--tag')
  const tag = i >= 0 ? argv[i + 1] : undefined
  if (!tag || tag.startsWith('--')) {
    throw new Error('usage: node scripts/verify-published-release.mjs --tag v<version> [--channel pilot]')
  }
  return { tag, channel: parseChannel(argv, { defaultChannel: 'pilot' }) }
}

async function main(argv) {
  let args
  try {
    args = parseArgs(argv)
  } catch (e) {
    console.error(e.message)
    return 1
  }

  let result
  try {
    result = await verifyPublishedRelease(args)
  } catch (e) {
    // An unreachable GitHub is NOT a pass. Say which of the two it is — a rate
    // limit and a broken tool need different responses from the operator.
    console.error(`verify-published-release: FAIL — ${e instanceof GithubUnavailable && e.rateLimited ? 'GitHub rate limit' : 'could not read the release'}: ${e.message}`)
    return 1
  }

  console.log(`published-release — ${result.tag} on ${result.slug}, channel=${result.channel} (via ${result.source})`)
  for (const note of result.notes) console.log(`  note: ${note}`)

  if (!result.ok) {
    console.error(`\n✗ ${result.failures.length} publish-contract failure(s) — the GitHub Release does NOT match docs/RELEASING.md step 9:`)
    for (const f of result.failures) console.error(`   - [${f.code}] ${f.detail}`)
    return 1
  }
  console.log(`\n✓ release ${result.tag} matches docs/RELEASING.md step 9: published prerelease, exactly the 3 required assets, documented title, bilingual body with the verbatim advisory, installer bound to checksums/SHA256SUMS/ledger, and a byte-identical signed update manifest.`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(code => process.exit(code))
}

export const __cliPath = fileURLToPath(import.meta.url)
