// HIGH 5 — clean-install / lockfile-integrity attestation that is VERIFIED, not
// self-asserted.
//
// The prior gate trusted a bare `{ verified: true }`. A boolean an operator writes
// proves nothing about supply-chain integrity. A real attestation must:
//   * pin the SHA256 of the package-lock.json it was produced against, and that
//     hash must equal the lockfile on disk NOW (a lockfile edited after the clean
//     install invalidates the attestation);
//   * record the exact toolchain (node + npm versions) that ran the clean install,
//     so provenance is auditable;
//   * assert the install was a CLEAN `npm ci` (not a mutating `npm install`) in a
//     throwaway tree — the only mode that fails on a lock/`package.json` mismatch.
// Any missing field, a mismatched lock hash, or a non-clean install fails closed.

export const LOCK_ATTEST_SCHEME = 1

/**
 * @param attestation       release/lock-attest.json | null
 * @param currentLockSha256 sha256 of the package-lock.json on disk right now
 * @param channel           'public' | 'qa'
 * Returns { ok, verified, failures:[{code,detail}], provenance }.
 * qa tolerates an absent attestation (labeled unverified); public fails closed.
 */
export function verifyLockAttestation({ attestation, currentLockSha256, channel = 'public' } = {}) {
  const failures = []
  if (!attestation || typeof attestation !== 'object') {
    if (channel === 'public') failures.push({ code: 'lock-integrity-unattested', detail: 'no clean-install / lockfile-integrity attestation (npm ci in a clean staging)' })
    return { ok: channel !== 'public', verified: false, failures, provenance: null }
  }
  if (attestation.scheme !== LOCK_ATTEST_SCHEME) {
    failures.push({ code: 'lock-attest-scheme', detail: `lock attestation scheme ${JSON.stringify(attestation.scheme)} != ${LOCK_ATTEST_SCHEME}` })
  }
  // The recorded lock hash MUST equal the lockfile on disk now.
  if (!attestation.package_lock_sha256) {
    failures.push({ code: 'lock-attest-no-hash', detail: 'lock attestation records no package_lock_sha256' })
  } else if (currentLockSha256 && attestation.package_lock_sha256 !== currentLockSha256) {
    failures.push({ code: 'lock-attest-mismatch', detail: `attested package-lock ${short(attestation.package_lock_sha256)} != package-lock.json on disk ${short(currentLockSha256)} (lockfile changed since the clean install)` })
  } else if (!currentLockSha256) {
    failures.push({ code: 'lock-attest-no-lockfile', detail: 'no package-lock.json on disk to compare the attestation against' })
  }
  // Provenance: the toolchain that produced it.
  if (!attestation.node_version || !attestation.npm_version) {
    failures.push({ code: 'lock-attest-no-provenance', detail: 'lock attestation records no node/npm tool versions (provenance)' })
  }
  // The install must have been a CLEAN `npm ci`.
  if (attestation.ci_clean !== true) {
    failures.push({ code: 'lock-attest-not-clean', detail: `lock attestation ci_clean=${JSON.stringify(attestation.ci_clean)} — must be a clean \`npm ci\` in a throwaway tree` })
  }
  const ok = failures.length === 0
  return {
    ok: channel === 'public' ? ok : true,
    verified: ok,
    failures: channel === 'public' ? failures : [],
    provenance: ok ? { node: attestation.node_version, npm: attestation.npm_version, lock_sha256: attestation.package_lock_sha256 } : null
  }
}

function short(h) { return typeof h === 'string' ? h.slice(0, 12) + '…' : String(h) }
