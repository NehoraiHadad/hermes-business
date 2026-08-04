// Signing POLICY (pure) + a read-only signature verdict normaliser.
//
// Policy (fail-closed for distribution, honest for QA/dev/pilot):
//   * public — EVERY distributable EXE (installer AND app) must carry a signature
//     that signtool verifies (/pa), whose signer identity is on the approved
//     publisher/thumbprint allowlist, and that bears a trusted RFC3161 timestamp
//     (/tw). Missing ANY of these blocks public distribution. With NO allowlist
//     configured (the default — we do not assume a cert exists) public fails
//     closed: nothing is an approved signer.
//   * qa / pilot — may remain UNSIGNED. qa is labeled NON-DISTRIBUTABLE so an
//     unsigned build can never be mistaken for shippable. pilot is DIFFERENT: it
//     IS distributable despite being unsigned — it is an Alpha prerelease with no
//     code-signing certificate yet (docs/specs/versioning.md §13 stage 5); the
//     absence of a signature is disclosed (SmartScreen advisory, SHA256SUMS) at
//     the release-notes level, not hidden by this module. Every OTHER rigor gate
//     (attestation, binding chain, ledger, lock-integrity) still applies to pilot
//     — see scripts/lib/release/channel-policy.mjs.
// The runner (signtool.mjs) only READS; this module only DECIDES.

import { CHANNELS as CHANNEL_LIST } from '../parse-channel.mjs'

export const CHANNELS = new Set(CHANNEL_LIST)

/** Normalise a raw signature result into a verdict. Accepts either a
 * Get-AuthenticodeSignature shape or a signtool verdict (see signtool.mjs). */
export function classifySignature(raw) {
  if (!raw || raw.detectable === false) {
    return { signed: false, valid: false, trustedTimestamp: false, status: 'undetectable', publisher: null, thumbprint: null }
  }
  const status = String(raw.status || (raw.verified ? 'Valid' : 'NotSigned'))
  const valid = status === 'Valid' || raw.verified === true
  return {
    signed: status !== 'NotSigned',
    valid,
    trustedTimestamp: valid && !!(raw.timestamp || raw.rfc3161),
    status: valid ? 'Valid' : status,
    publisher: raw.publisher ? String(raw.publisher) : null,
    thumbprint: raw.thumbprint ? String(raw.thumbprint).replace(/\s+/g, '').toUpperCase() : null
  }
}

/** Is a verdict's signer on the approved allowlist? Empty allowlist → nobody is. */
export function signerApproved(sig, allowlist = {}) {
  const subjects = (allowlist.subjects || []).map(s => String(s).toLowerCase())
  const thumbs = (allowlist.thumbprints || []).map(t => String(t).replace(/\s+/g, '').toUpperCase())
  const subjOk = !!sig.publisher && subjects.includes(String(sig.publisher).toLowerCase())
  const thumbOk = !!sig.thumbprint && thumbs.includes(sig.thumbprint)
  return subjOk || thumbOk
}

/**
 * Decide the signing verdict for a channel.
 *   channel   : 'public' | 'qa' | 'pilot'
 *   installer/app : signature verdict (classifySignature) | null
 *   allowlist : { subjects:[], thumbprints:[] } — approved signer identities
 * Returns { channel, failures[], distributable, label, signed }.
 */
export function evaluateSigning({ channel, installer, app, allowlist = {} } = {}) {
  if (!CHANNELS.has(channel)) {
    return { channel, failures: [{ code: 'unknown-channel', detail: `channel "${channel}"` }], distributable: false, label: 'NON-DISTRIBUTABLE (unknown channel)', signed: false }
  }
  const failures = []
  const parts = { installer, app }
  const bothValid = !!(installer && installer.valid && app && app.valid)
  if (channel === 'public') {
    for (const [k, s] of Object.entries(parts)) {
      if (!s || !s.valid) {
        failures.push({ code: 'unsigned-public', detail: `${k} has no signtool-verifiable signature (status=${s ? s.status : 'absent'})` })
        continue
      }
      if (!s.trustedTimestamp) {
        failures.push({ code: 'untrusted-timestamp-public', detail: `${k} signature carries no trusted RFC3161 timestamp` })
      }
      if (!signerApproved(s, allowlist)) {
        failures.push({ code: 'publisher-not-approved', detail: `${k} signer ${s.publisher || s.thumbprint || 'unknown'} is not on the approved publisher/thumbprint allowlist` })
      }
    }
  }
  // pilot is distributable WITHOUT a signature — it is an honest, disclosed Alpha
  // prerelease (docs/specs/versioning.md §13 stage 5), not a shortcut around the
  // public bar. Its per-item loop above never ran (only `public` does), so
  // `failures` is always empty here for pilot; the explicit `channel === 'pilot'`
  // branch makes that a deliberate policy statement, not an accident of an empty
  // array being falsy-safe.
  const distributable = channel === 'public' ? failures.length === 0 : channel === 'pilot'
  const label = distributable
    ? channel === 'public'
      ? 'DISTRIBUTABLE (public, signed by approved publisher, timestamped)'
      : 'DISTRIBUTABLE (pilot Alpha — UNSIGNED, SmartScreen expected; verify SHA256SUMS.txt)'
    : channel === 'qa'
      ? 'NON-DISTRIBUTABLE (QA/dev — unsigned/unverified)'
      : 'NON-DISTRIBUTABLE (public signing gate not met)'
  return { channel, failures, distributable, label, signed: bothValid }
}
