// Pure decision layer behind `scripts/verify-published-release.mjs` — does the
// GitHub Release that is ACTUALLY PUBLISHED match the one docs/RELEASING.md
// step 9 specifies?
//
// ── Why this exists ──────────────────────────────────────────────────────────
// Every other stage of a release is machine-verified: the artifact set, the
// checksums, the payload binding, the signing phase, the ledger, the evidence
// envelopes, even the git tag (scripts/verify-version-tag.mjs). The PUBLISH step
// is the single manual action left, and it is performed by hand from a prose
// checklist — so it is the one place where a release can be wrong while every
// gate stays green. That is not hypothetical: publishing v0.4.0-alpha.10 drifted
// from the checklist within minutes of it being read — a Hebrew title instead of
// the Latin-script one, `checksums.json` uploaded in place of `SHA256SUMS.txt`
// (the very file the mandated advisory tells users to verify against), and a
// Hebrew-only body with no English opening. Nothing noticed; it was caught by
// re-reading the checklist. This module is that re-reading, mechanised.
//
// ── Why the expectations are PARSED out of docs/RELEASING.md ─────────────────
// The checklist is the specification. Re-typing its title template, its asset
// list, its Hebrew section heading and its verbatim installation advisory into
// this file would create a SECOND source of truth that can drift from the first
// silently — and the failure mode of that drift is the worst possible one: a
// verifier that confidently passes a release which no longer matches the
// document a human is following. So the expected strings are EXTRACTED from
// step 9 of the doc, and a doc we cannot parse is a FAILURE, never a skipped
// check. The one exception is the installer's file name, which is already
// pinned in code (electron/update-artifact-name.cjs, re-exported by
// scripts/lib/release/artifact-set.mjs): there the doc is checked AGAINST the
// code, so the two can never disagree without someone hearing about it.
//
// ── Why this module is NOT in scripts/lib/release/ ───────────────────────────
// `scripts/lib/release/**` is inside PACKAGED_INPUTS (scripts/lib/subject-
// registry.mjs, RELEASE_SECURITY_PIPELINE) — a new file there changes the
// packaged-source fingerprint and invalidates the evidence envelopes of the
// version that is CURRENTLY PUBLISHED, which is exactly the artifact this tool
// is meant to inspect. It also does not belong there on the merits: everything
// in that tree decides whether an artifact may be PRODUCED, and runs before
// publication; this decides whether a published release is FAITHFUL, and runs
// after.
//
// PURE: no fs, no net, no crypto, no key material. The signature check is
// INJECTED (`verifyManifest`), the same way scripts/lib/release/update-manifest.mjs
// injects it, so every fail-closed branch is unit-testable without keys.

import { decideVersionTag } from './release/version-tag.mjs'
import { expectedInstallerName } from './release/artifact-set.mjs'
import { crossCheckInstallerDigest } from './release/update-manifest.mjs'
import { assertKnownChannel } from './release/channel-policy.mjs'

/** How many `release/<asset>` arguments step 9's `gh release create` carries.
 * Only used to make the PARSER fail loudly if the document changes shape — the
 * asset NAMES themselves are read out of the document, never restated here. */
export const REQUIRED_ASSET_COUNT = 3

// ---------------------------------------------------------------------------
// Parsing the specification out of docs/RELEASING.md step 9
// ---------------------------------------------------------------------------

/** Slice the markdown down to step 9 ("Create the GitHub Release"), so a phrase
 * that also appears in step 8 or 10 can never be mistaken for step 9's. Returns
 * null when the step cannot be located at all — an unrecognisable checklist is a
 * refusal, not a reason to relax. */
function step9Slice(markdown) {
  const text = String(markdown ?? '')
  const start = text.search(/^9\.\s+\*\*Create the GitHub Release/m)
  if (start < 0) return null
  const rest = text.slice(start)
  const end = rest.search(/^10\.\s/m)
  return end < 0 ? rest : rest.slice(0, end)
}

/**
 * Collapse an advisory (or any quoted prose) to ONE comparable string.
 *
 * The doc hard-wraps the advisory across four `> `-prefixed lines to fit its
 * column budget; the published release body carries the same sentence as a
 * single long line. Those are the SAME text — the difference is typesetting, not
 * content — so both sides are normalised identically before comparison: strip
 * any blockquote marker, then collapse every run of whitespace to one space.
 *
 * Deliberately NOT normalised: punctuation, the Hebrew maqaf, the em dash,
 * markdown emphasis, or the `SHA256SUMS.txt` code span. Those carry the meaning
 * the checklist says must not be paraphrased away, so a change to any of them
 * MUST fail rather than be smoothed over.
 */
export function normalizeQuotedText(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*>\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract everything step 9 mandates:
 *   titleTemplate    — the `--title "..."` argument, with `<version>` still in it
 *   assetNames       — the three `release/<name>` arguments, in document order
 *   changelogHeading — the Hebrew section heading the body must carry
 *   advisory         — the verbatim installation advisory (normalised)
 *
 * Every field is independently fail-closed: whatever cannot be found is reported
 * in `errors` and left null, and `decidePublishedRelease` turns each null into a
 * failure rather than skipping the check it would have driven.
 */
export function parseReleasingContract(markdown) {
  const errors = []
  const slice = step9Slice(markdown)
  if (!slice) {
    return {
      titleTemplate: null,
      assetNames: null,
      changelogHeading: null,
      advisory: null,
      errors: ['could not locate step 9 ("Create the GitHub Release") — the publish specification is unreadable']
    }
  }

  const titleMatch = /--title\s+"([^"]+)"/.exec(slice)
  const titleTemplate = titleMatch ? titleMatch[1] : null
  if (!titleTemplate) errors.push('step 9: no `--title "..."` argument found')
  else if (!titleTemplate.includes('<version>')) {
    errors.push(`step 9: --title template ${JSON.stringify(titleTemplate)} has no <version> placeholder to substitute`)
  }

  const assetNames = [...slice.matchAll(/"release\/([^"]+)"/g)].map(m => m[1])
  if (assetNames.length !== REQUIRED_ASSET_COUNT) {
    errors.push(`step 9: expected ${REQUIRED_ASSET_COUNT} "release/<asset>" arguments, found ${assetNames.length}${assetNames.length ? ` (${assetNames.join(', ')})` : ''}`)
  }

  const headingMatch = /`(###\s+[^`]+)`/.exec(slice)
  const changelogHeading = headingMatch ? headingMatch[1].trim() : null
  if (!changelogHeading) errors.push('step 9: no `### ...` Hebrew section heading quoted')

  // The advisory is the LAST contiguous blockquote block in step 9 — today the
  // only one, but anchored from the end so that a future explanatory quote added
  // ABOVE it cannot silently become "the advisory".
  const quoted = [...slice.matchAll(/(?:^[ \t]*>.*(?:\r?\n|$))+/gm)].map(m => m[0])
  const advisory = quoted.length ? normalizeQuotedText(quoted[quoted.length - 1]) : null
  if (!advisory) errors.push('step 9: no `>` blockquote carrying the verbatim installation advisory')

  return { titleTemplate, assetNames: assetNames.length ? assetNames : null, changelogHeading, advisory, errors }
}

/** Substitute the version into the doc's title template. */
export function expectedReleaseTitle(titleTemplate, version) {
  if (!titleTemplate || !version) return null
  return titleTemplate.split('<version>').join(version)
}

/** Substitute the version into the doc's asset list. */
export function expectedAssetNames(assetNames, version) {
  if (!Array.isArray(assetNames) || !version) return null
  return assetNames.map(n => n.split('<version>').join(version))
}

// ---------------------------------------------------------------------------
// SHA256SUMS.txt
// ---------------------------------------------------------------------------

/**
 * Parse the `sha256  <bytes>  <name>` table written by
 * scripts/gen-installer-checksums.mjs / finalize-release.mjs.
 *
 * This file is not decoration: the mandated advisory tells every pilot tester to
 * verify the installer against it, so it is the ONE artifact whose absence turns
 * an honest "unsigned — verify it yourself" disclosure into a lie. It is parsed
 * here (rather than trusting checksums.json alone) precisely so the two can be
 * held against each other.
 */
export function parseSha256Sums(text) {
  const entries = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+(\d+)\s+(\S.*)$/.exec(line.trim())
    if (m) entries.push({ sha256: m[1], bytes: Number(m[2]), name: m[3].trim() })
  }
  return entries
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

function fail(failures, code, detail) {
  failures.push({ code, detail })
}

/**
 * Decide whether a published GitHub Release is the one the checklist specifies.
 *
 * Every argument is an ALREADY-RESOLVED fact; the CLI does the IO. Anything
 * unresolvable (a release that could not be fetched, a local file that could not
 * be read, an asset that could not be downloaded) arrives as null and becomes a
 * FAILURE — never a silently skipped check.
 *
 *   channel               : 'pilot' | 'public' | 'qa'
 *   tag                   : the tag under test, e.g. "v0.4.0-alpha.10"
 *   packageVersion        : package.json version on the checked-out HEAD
 *   release               : { tagName, name, body, draft, prerelease,
 *                             assets:[{ name, size, digest }] } | null
 *   contract              : parseReleasingContract(docs/RELEASING.md) | null
 *   checksums             : parsed release/checksums.json | null
 *   sha256sumsText        : raw release/SHA256SUMS.txt | null
 *   ledger                : parsed release-ledger.json | null
 *   localManifestText     : raw release/update-manifest.json | null
 *   publishedManifestText : the DOWNLOADED update-manifest.json asset | null
 *   verifyManifest        : injected ({ manifest, expectedVersion }) => { ok, code?, detail }
 *
 * Returns { ok, version, failures:[{ code, detail }], notes:[string] }.
 */
export function decidePublishedRelease({
  channel = 'pilot',
  tag,
  packageVersion,
  release = null,
  contract = null,
  checksums = null,
  sha256sumsText = null,
  ledger = null,
  localManifestText = null,
  publishedManifestText = null,
  verifyManifest = null
} = {}) {
  assertKnownChannel(channel)
  const failures = []
  const notes = []

  // ---- 2. the tag names the version this working tree carries ---------------
  // decideVersionTag is the existing single source for "does v<x> name <x>"; the
  // git-collaborator half (tag ↔ HEAD) is deliberately NOT driven from here —
  // scripts/verify-version-tag.mjs already owns that, and a published release may
  // legitimately be inspected from a later HEAD.
  const tagVerdict = decideVersionTag({ tag, packageVersion })
  if (!tagVerdict.ok) fail(failures, tagVerdict.code, tagVerdict.reason)
  const version = tagVerdict.version || null

  // The specification must be readable before anything can be checked against it.
  for (const err of contract?.errors ?? ['docs/RELEASING.md was not supplied']) {
    fail(failures, 'releasing-doc-unreadable', `docs/RELEASING.md: ${err}`)
  }

  // ---- 1. the release exists, is published, and carries the right flag ------
  if (!release) {
    fail(failures, 'release-absent', `no published GitHub Release found for tag ${tag} (or it could not be read) — a release that cannot be read is never assumed good`)
    return { ok: false, version, failures, notes }
  }
  if (release.tagName && tag && release.tagName !== tag) {
    fail(failures, 'release-tag-mismatch', `release reports tag ${release.tagName} but ${tag} was requested`)
  }
  if (release.draft !== false) {
    fail(failures, 'release-draft', `release ${tag} is a DRAFT (draft=${JSON.stringify(release.draft)}) — its assets are not public, so nothing downstream of it is real`)
  }
  // qa is never distributed at all (the release/qa-thin-installer-DO-NOT-
  // DISTRIBUTE marker is the precedent); pilot is an Alpha prerelease; public is
  // the only channel that may be marked as a full release.
  if (channel === 'qa') {
    fail(failures, 'channel-not-publishable', 'the qa channel is never distributed — a published qa release is itself the defect')
  }
  const expectPrerelease = channel !== 'public'
  if (release.prerelease !== expectPrerelease) {
    fail(failures, 'prerelease-flag-wrong', `release ${tag} has prerelease=${JSON.stringify(release.prerelease)} but the ${channel} channel requires prerelease=${expectPrerelease}`)
  }

  // ---- 3. EXACTLY the three required assets ---------------------------------
  // Missing and extra are reported SEPARATELY because they are different
  // mistakes with different consequences: a missing SHA256SUMS.txt breaks the
  // verification the advisory promises, while an extra checksums.json offers a
  // second, unmandated file for a user to "verify" against.
  const expectedAssets = expectedAssetNames(contract?.assetNames, version)
  const publishedAssets = Array.isArray(release.assets) ? release.assets : []
  const publishedNames = publishedAssets.map(a => a?.name).filter(n => typeof n === 'string')
  let installerAssetName = null
  if (expectedAssets) {
    // Cross-bind the doc to the code: the installer's name is pinned by
    // electron/update-artifact-name.cjs, so the doc drifting away from it is a
    // failure in its own right rather than a new expectation quietly adopted.
    const pinned = expectedInstallerName(null, version)
    if (!expectedAssets.includes(pinned)) {
      fail(failures, 'doc-installer-name-drift', `docs/RELEASING.md step 9 uploads ${expectedAssets.join(', ')} but the pinned artifact name is ${pinned} (electron/update-artifact-name.cjs)`)
    } else {
      installerAssetName = pinned
    }
    for (const name of expectedAssets) {
      if (!publishedNames.includes(name)) fail(failures, 'asset-missing', `required asset ${name} is NOT attached to ${tag}`)
    }
    for (const name of publishedNames) {
      if (!expectedAssets.includes(name)) fail(failures, 'asset-unexpected', `unexpected asset ${name} attached to ${tag} — step 9 uploads exactly ${expectedAssets.join(', ')}`)
    }
  }

  // ---- 4. the documented, Latin-script title --------------------------------
  const expectedTitle = expectedReleaseTitle(contract?.titleTemplate, version)
  if (expectedTitle && release.name !== expectedTitle) {
    fail(failures, 'title-mismatch', `release title ${JSON.stringify(release.name)} != ${JSON.stringify(expectedTitle)} (docs/RELEASING.md step 9)`)
  }

  // ---- 5. a BILINGUAL body carrying the Hebrew section + verbatim advisory ---
  const body = typeof release.body === 'string' ? release.body : ''
  if (!body.trim()) {
    fail(failures, 'body-absent', `release ${tag} has an empty body — the in-app update panel renders this text to pilot testers`)
  } else {
    if (contract?.changelogHeading && !body.includes(contract.changelogHeading)) {
      fail(failures, 'body-changelog-heading-missing', `release body does not carry the ${JSON.stringify(contract.changelogHeading)} section from CHANGELOG.md`)
    }
    if (contract?.advisory && !normalizeQuotedText(body).includes(contract.advisory)) {
      fail(failures, 'body-advisory-missing', 'release body does not carry the installation advisory VERBATIM (unsigned / SmartScreen / verify against SHA256SUMS.txt) — docs/RELEASING.md step 9 says copy it, do not paraphrase')
    }
  }

  // ---- 6. published installer bytes ↔ checksums.json ↔ SHA256SUMS ↔ ledger ---
  const checksumEntry = installerAssetName && Array.isArray(checksums?.installers)
    ? checksums.installers.find(e => e && e.name === installerAssetName)
    : null
  if (installerAssetName) {
    if (!checksums) fail(failures, 'checksums-unreadable', 'release/checksums.json could not be read — nothing to bind the published asset to')
    else if (!checksumEntry) fail(failures, 'checksums-entry-absent', `release/checksums.json has no entry for ${installerAssetName}`)

    if (sha256sumsText === null) {
      fail(failures, 'sha256sums-unreadable', 'release/SHA256SUMS.txt could not be read — the file the advisory tells users to verify against')
    } else {
      const sumEntry = parseSha256Sums(sha256sumsText).find(e => e.name === installerAssetName)
      if (!sumEntry) fail(failures, 'sha256sums-entry-absent', `release/SHA256SUMS.txt has no line for ${installerAssetName}`)
      else if (checksumEntry) {
        if (sumEntry.sha256 !== checksumEntry.sha256) {
          fail(failures, 'sha256sums-digest-disagrees', `SHA256SUMS.txt sha256 ${sumEntry.sha256} != checksums.json ${checksumEntry.sha256} for ${installerAssetName}`)
        }
        if (sumEntry.bytes !== Number(checksumEntry.bytes)) {
          fail(failures, 'sha256sums-bytes-disagrees', `SHA256SUMS.txt size ${sumEntry.bytes} != checksums.json ${checksumEntry.bytes} for ${installerAssetName}`)
        }
      }
    }

    const publishedInstaller = publishedAssets.find(a => a?.name === installerAssetName) || null
    if (publishedInstaller && checksumEntry) {
      if (Number(publishedInstaller.size) !== Number(checksumEntry.bytes)) {
        fail(failures, 'installer-size-mismatch', `published ${installerAssetName} is ${publishedInstaller.size} bytes but release/checksums.json records ${checksumEntry.bytes} — the uploaded binary is not the one this tree measured`)
      }
      // GitHub reports an asset digest as `sha256:<hex>` when it has one. When it
      // does, that is free, decisive proof about the PUBLISHED bytes, so a
      // mismatch is fatal. When it does not, we say so out loud: size agreement
      // alone does not prove the bytes, and the only stronger local proof would be
      // re-downloading ~100 MB, which this read-only checker deliberately does not
      // do. An honest note beats a silent assumption in either direction.
      const digest = typeof publishedInstaller.digest === 'string' ? publishedInstaller.digest.replace(/^sha256:/, '') : null
      if (digest && digest !== checksumEntry.sha256) {
        fail(failures, 'installer-digest-mismatch', `published ${installerAssetName} digest ${digest} != release/checksums.json ${checksumEntry.sha256}`)
      } else if (!digest) {
        notes.push(`GitHub reported no digest for ${installerAssetName}: the published bytes are bound by SIZE only (the signed manifest still pins the digest an updater will enforce)`)
      }
    }

    // The ledger is the version-immutability record (docs/RELEASING.md step 10).
    // An absent entry for a version that is ALREADY published is a real gap —
    // crossCheckInstallerDigest tolerates absence by design (it also runs before
    // publication, when there is nothing to record yet), so the presence check is
    // made here, explicitly.
    if (!ledger) fail(failures, 'ledger-unreadable', 'release-ledger.json could not be read')
    else if (!ledger.entries?.[version]) {
      fail(failures, 'ledger-entry-absent', `release-ledger.json has no entry for v${version} — step 10 records every published asset's sha256`)
    }
  }

  // ---- 7. the PUBLISHED manifest asset, byte-for-byte + signature -----------
  if (localManifestText === null) {
    fail(failures, 'local-manifest-unreadable', 'release/update-manifest.json could not be read')
  }
  if (publishedManifestText === null) {
    fail(failures, 'published-manifest-unavailable', `the update-manifest.json asset of ${tag} could not be downloaded — an unverifiable manifest is never assumed good`)
  }
  if (localManifestText !== null && publishedManifestText !== null && localManifestText !== publishedManifestText) {
    fail(failures, 'manifest-bytes-differ', 'the published update-manifest.json is NOT byte-identical to release/update-manifest.json — the app verifies the PUBLISHED document, so a difference means the shipped trust statement is not the one this tree produced')
  }
  if (publishedManifestText !== null) {
    let manifest = null
    try {
      manifest = JSON.parse(publishedManifestText)
    } catch (e) {
      fail(failures, 'published-manifest-unparseable', `the published update-manifest.json is not valid JSON (${e.message})`)
    }
    if (manifest) {
      if (typeof verifyManifest !== 'function') {
        fail(failures, 'manifest-verifier-absent', 'no manifest verifier was injected — refusing to report a signature as verified without checking it')
      } else {
        const verdict = verifyManifest({ manifest, expectedVersion: version })
        if (!verdict?.ok) {
          fail(failures, `manifest-${verdict?.code || 'unverified'}`, `published update-manifest.json does not verify against the shipped trust keys: ${verdict?.detail || 'no detail'}`)
        }
      }
      // The manifest's own installer record must agree with checksums.json and the
      // ledger. Reused, not reimplemented: this is the same cross-check
      // finalize-release.mjs runs before publication.
      const cross = crossCheckInstallerDigest({ manifest, checksums, ledger })
      if (!cross.ok) fail(failures, `manifest-crosscheck-${cross.code}`, cross.detail)
      else notes.push(`manifest installer digest: ${cross.detail}`)
    }
  }

  return { ok: failures.length === 0, version, failures, notes }
}
