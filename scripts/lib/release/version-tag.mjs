// Pure decision behind `scripts/verify-version-tag.mjs` — asserts a git tag name
// (v<version>) names the EXACT version the checked-out HEAD's package.json
// carries (docs/specs/versioning.md D2, §5.4 checklist step 10). Read-only: this
// module makes no assertion the release pipeline hasn't already made elsewhere
// (attestation/binding-chain/ledger); it closes the one remaining loop those
// don't cover — that the PUBLIC name (`v<version>`) really points at the commit
// that carries that version, not merely that the string parses.
//
// Pure/impure split mirrors the rest of scripts/lib/release: this module decides
// over already-resolved facts; scripts/verify-version-tag.mjs shells to git and
// reads package.json.

const SEMVER_TAG_RE = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/

/** Extract the semver from a `v<semver>` tag name, or null if malformed. */
export function parseTagVersion(tag) {
  const m = SEMVER_TAG_RE.exec(String(tag ?? '').trim())
  return m ? m[1] : null
}

/**
 * Decide whether `tag` legitimately names `packageVersion` at the current HEAD.
 *   tag            : the git tag name under test, e.g. "v0.4.0-alpha.2"
 *   packageVersion : package.json "version" on the checked-out HEAD
 *   resolveTagCommit(tag) => commit sha | null   — OPTIONAL; when provided
 *   currentHead()          => commit sha | null   — (with resolveTagCommit) both
 *     must be supplied together to also prove the tag points AT this commit, not
 *     merely that the version strings agree. Omitted (unit tests, or a caller
 *     that only wants the naming check) → that half is skipped, never faked.
 * Returns { ok, code?, reason?, version?, tag }.
 */
export function decideVersionTag({ tag, packageVersion, resolveTagCommit, currentHead } = {}) {
  const version = parseTagVersion(tag)
  if (!version) {
    return { ok: false, code: 'tag-not-semver', reason: `tag ${JSON.stringify(tag)} is not of the form v<MAJOR.MINOR.PATCH[-prerelease]>`, tag }
  }
  if (!packageVersion) {
    return { ok: false, code: 'package-version-missing', reason: 'no package.json version to compare against', tag, version }
  }
  if (version !== packageVersion) {
    return {
      ok: false, code: 'version-mismatch',
      reason: `tag ${tag} names version ${version} but package.json version is ${packageVersion}`,
      tag, version
    }
  }
  if (typeof resolveTagCommit === 'function' && typeof currentHead === 'function') {
    const tagCommit = resolveTagCommit(tag)
    if (!tagCommit) {
      return { ok: false, code: 'tag-not-found', reason: `git tag ${tag} does not exist (or is unreachable)`, tag, version }
    }
    const head = currentHead()
    if (!head) {
      return { ok: false, code: 'head-unresolvable', reason: 'could not resolve the current HEAD commit', tag, version }
    }
    if (tagCommit !== head) {
      return {
        ok: false, code: 'tag-not-head',
        reason: `tag ${tag} points at ${short(tagCommit)} but HEAD is ${short(head)}`,
        tag, version
      }
    }
  }
  return { ok: true, tag, version }
}

function short(sha) {
  return typeof sha === 'string' && sha.length > 12 ? sha.slice(0, 12) : String(sha)
}
