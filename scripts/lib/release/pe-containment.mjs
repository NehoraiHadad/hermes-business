// CRITICAL 2 (final verifier) — extract EVERY shipped PE from the NSIS payload and
// re-verify the EXACT copies, so the public "signed" claim is proven against the
// bytes actually inside the installer, not the loose win-unpacked tree.
//
// The loose payload-signing gate (pe-inventory.mjs) proves the win-unpacked copies
// are signed; this proves the INSTALLER carries those same signed copies. Off-box
// (no 7z-family extractor / no signtool) the re-verification is honestly not-proven
// and the public gate fails closed — never faked.
//
// The pure decision (`decidePayloadPeCoverage`) is unit-tested with synthetic
// extraction results; the runner (`extractAndVerifyPayloadPes`) injects the resolved
// 7za + signtool so no real installer/cert is needed in tests.

import { createHash } from 'node:crypto'

/**
 * Decide whether the extracted payload PEs cover and re-verify the must-sign set.
 *   channel   : 'public' | 'qa'
 *   mustSign  : string[] POSIX-relative payload PE paths that MUST be signed
 *   extracted : [{ path, extracted:boolean, signature }] — per-PE extraction +
 *               classifySignature() verdict from INSIDE the installer
 *   signerApproved : (sig, allowlist) => boolean (injected to avoid a cycle)
 *   allowlist : approved signer identities
 * Returns { ok, proven, failures:[{code,detail}], covered, digest }.
 * qa → not distributable but never blocks; public requires every must-sign PE to be
 * extracted, valid, timestamped and approved.
 */
export function decidePayloadPeCoverage({ channel = 'public', mustSign = [], extracted = [], signerApproved, allowlist = {} } = {}) {
  const byPath = new Map(extracted.map(e => [String(e.path).replace(/\\/g, '/'), e]))
  const failures = []
  if (channel !== 'public') {
    return { ok: true, proven: false, failures, covered: extracted.length, digest: coverageDigest(extracted) }
  }
  let verifiedCount = 0
  for (const rel of mustSign.map(p => String(p).replace(/\\/g, '/'))) {
    const e = byPath.get(rel)
    if (!e || e.extracted !== true) {
      failures.push({ code: 'pe-not-in-payload', detail: `must-sign PE ${rel} could not be extracted from the installer payload for re-verification` })
      continue
    }
    const sig = e.signature
    if (!sig || !sig.valid) {
      failures.push({ code: 'pe-inside-unsigned', detail: `payload copy of ${rel} has no signtool-verifiable signature (status=${sig ? sig.status : 'absent'})` })
      continue
    }
    if (!sig.trustedTimestamp) failures.push({ code: 'pe-inside-untrusted-timestamp', detail: `payload copy of ${rel} carries no trusted RFC3161 timestamp` })
    if (typeof signerApproved === 'function' && !signerApproved(sig, allowlist)) {
      failures.push({ code: 'pe-inside-publisher-not-approved', detail: `payload copy of ${rel} signer ${sig.publisher || sig.thumbprint || 'unknown'} is not on the approved allowlist` })
    }
    if (sig.valid && sig.trustedTimestamp && (typeof signerApproved !== 'function' || signerApproved(sig, allowlist))) verifiedCount += 1
  }
  const proven = failures.length === 0 && mustSign.length > 0 && verifiedCount === mustSign.length
  return { ok: failures.length === 0, proven, failures, covered: verifiedCount, digest: coverageDigest(extracted) }
}

/** Order-independent digest over the extracted PE identities (path + signature
 * thumbprint), scheme-versioned so an extraction-scheme change stops matching. */
export function coverageDigest(extracted = []) {
  const parts = extracted
    .map(e => `${String(e.path).replace(/\\/g, '/')}=${e.signature?.thumbprint || (e.extracted ? 'unsigned' : 'absent')}`)
    .sort()
  return createHash('sha256').update(`pe-coverage-v1\n${parts.join('\n')}`).digest('hex')
}

/**
 * Extract each must-sign PE from the installer and classify its signature. Every I/O
 * seam is injected so this is exercised without a real installer/cert:
 *   installerPath : the packaged .exe
 *   mustSign      : string[] payload-relative PE paths
 *   extractTo     : (installerPath, innerPath) => absPath|null — extract one entry
 *                   to a temp file, or null when the extractor/entry is unavailable
 *   probe         : (absPath) => classifySignature() verdict
 * Returns [{ path, extracted, signature }]. Never throws.
 */
export function extractAndVerifyPayloadPes({ installerPath, mustSign = [], extractTo, probe } = {}) {
  const out = []
  for (const rel of mustSign) {
    let abs = null
    try { abs = typeof extractTo === 'function' ? extractTo(installerPath, rel) : null } catch { abs = null }
    if (!abs) { out.push({ path: rel, extracted: false, signature: null }); continue }
    let signature = null
    try { signature = typeof probe === 'function' ? probe(abs) : null } catch { signature = null }
    out.push({ path: rel, extracted: true, signature })
  }
  return out
}
