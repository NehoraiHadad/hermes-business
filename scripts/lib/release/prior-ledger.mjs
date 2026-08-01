// Pure version-immutability decision against a DURABLE prior-release ledger.
//
// The old `version-collision` rule compared an installer's sha256 to a checksum
// manifest that was regenerated from the SAME bytes — it could only ever agree, so
// it proved nothing about whether this version was already published with
// DIFFERENT bytes. Real immutability needs an INDEPENDENT, durable record of what
// each version was released as: a signed, committed ledger and/or the digest of
// the GitHub release asset. This module decides over that external input; it never
// recomputes it from the candidate bytes.
//
// Ledger shape (loaded by gather.mjs from a trusted source):
//   { source: 'signed-ledger' | 'github-asset' | null,
//     entries: { [version]: { sha256, released_at? } } }
// `source: null` (or a null ledger) means we have NO durable prior-release record.

export const TRUSTED_SOURCES = new Set(['signed-ledger', 'github-asset'])

/**
 * Decide whether shipping `installerSha256` under `version` is immutability-safe.
 *   channel        : 'public' | 'qa'
 *   version        : package.json version being released
 *   installerSha256: sha256 of the candidate installer
 *   ledger         : durable prior-release ledger (see above) | null
 * Returns { ok, verified, code?, detail, label }.
 *   - No trusted ledger  → public FAILS closed (can't prove immutability);
 *                          qa is allowed but labeled `unverified`.
 *   - Version present, SAME sha → idempotent re-release (ok, verified).
 *   - Version present, DIFFERENT sha → hard `version-reuse` collision.
 *   - Version absent → a genuinely new version (ok, verified).
 */
export function checkVersionImmutability({ channel = 'public', version, installerSha256, ledger } = {}) {
  const trusted = !!(ledger && TRUSTED_SOURCES.has(ledger.source) && ledger.entries && typeof ledger.entries === 'object')
  if (!trusted) {
    if (channel === 'public') {
      return {
        ok: false, verified: false, code: 'version-ledger-unavailable',
        detail: `no durable signed/GitHub prior-release ledger to prove v${version} was not already published; public fails closed`,
        label: 'UNVERIFIED (no durable ledger)'
      }
    }
    return { ok: true, verified: false, detail: `v${version} immutability UNVERIFIED (no durable ledger; allowed for qa)`, label: 'UNVERIFIED (qa)' }
  }
  const prior = ledger.entries[version]
  if (!prior) {
    return { ok: true, verified: true, detail: `v${version} is new — no prior release in the ${ledger.source}`, label: 'VERIFIED (new version)' }
  }
  if (!installerSha256) {
    return { ok: false, verified: false, code: 'version-reuse', detail: `v${version} is in the ledger but the candidate installer has no measurable sha256`, label: 'BLOCKED (no candidate hash)' }
  }
  if (prior.sha256 === installerSha256) {
    return { ok: true, verified: true, detail: `v${version} matches the previously-released asset (idempotent re-release)`, label: 'VERIFIED (idempotent)' }
  }
  return {
    ok: false, verified: true, code: 'version-reuse',
    detail: `v${version} was ALREADY released as ${short(prior.sha256)} but this build is ${short(installerSha256)} — bump the version (immutability)`,
    label: 'BLOCKED (version reuse)'
  }
}

function short(h) {
  return typeof h === 'string' ? h.slice(0, 12) + '…' : String(h)
}
