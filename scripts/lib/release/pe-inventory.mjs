// CRITICAL 2 — enumerate EVERY shipped Windows executable and decide the set the
// public "signed" claim must cover.
//
// The incident: the public gate only classified the installer .exe and the product
// .exe. electron-builder's win-unpacked payload also ships resources/elevate.exe
// (the NSIS/UAC helper), the Electron runtime DLLs (ffmpeg, libEGL, libGLESv2,
// vk_swiftshader, d3dcompiler_47, …) and any *.node native addon. A "signed build"
// claim that silently omits these is dishonest — an attacker who swaps elevate.exe
// ships unsigned code under a signed installer.
//
// Signing ORDER also mattered: `win.signAndEditExecutable=false` disabled
// electron-builder's own per-file signing, so nothing inside win-unpacked was ever
// signed. The fix (afterSign/beforePack hook) must sign every PE BEFORE NSIS
// compresses the payload; the report then verifies the EXTRACTED copies. This
// module is the pure policy: given a directory listing it returns the exact PE set,
// splits it into the must-sign set and a JUSTIFIED exclusion allowlist, and flags
// any exclusion that lacks a written justification (an un-justified exclusion is a
// hole and blocks public).

import path from 'node:path'

export const PE_EXTENSIONS = new Set(['.exe', '.dll', '.node'])

/** Is this relative path a shippable PE by extension? */
export function isPe(relPath) {
  return PE_EXTENSIONS.has(path.extname(String(relPath)).toLowerCase())
}

/**
 * Classify a flat listing of payload-relative paths into the signing subject set.
 *   listing   : string[] of POSIX-relative paths inside win-unpacked (+ the
 *               installer name(s) in release/). Non-PE paths are ignored.
 *   allowlist : [{ path, reason }] — PEs deliberately NOT signed, each with a
 *               written justification. A path on the allowlist WITHOUT a non-empty
 *               reason is rejected (`unjustified-exclusion`).
 * Returns { all, mustSign, excluded, unjustified } — `mustSign` is every shipped PE
 * that is not justifiably excluded; `unjustified` are exclusions missing a reason.
 */
export function classifyShippedPes(listing = [], { allowlist = [] } = {}) {
  const norm = p => String(p).replace(/\\/g, '/')
  const all = [...new Set(listing.map(norm).filter(isPe))].sort()
  const allowMap = new Map()
  const unjustified = []
  for (const entry of allowlist) {
    const p = norm(entry?.path || entry)
    const reason = typeof entry === 'object' ? String(entry.reason || '').trim() : ''
    if (!reason) unjustified.push(p)
    else allowMap.set(p, reason)
  }
  const excluded = []
  const mustSign = []
  for (const p of all) {
    if (allowMap.has(p)) excluded.push({ path: p, reason: allowMap.get(p) })
    else mustSign.push(p)
  }
  // An allowlist entry that names a PE not actually shipped is stale but harmless;
  // one WITHOUT a reason is a real hole even if the PE is shipped.
  return { all, mustSign, excluded, unjustified: [...new Set(unjustified)].sort() }
}

/**
 * The signing verdict over the WHOLE shipped-PE set for a channel.
 *   channel   : 'public' | 'qa'
 *   pes       : [{ path, signature }] — signature is a classifySignature() verdict
 *               (or null when unsigned/undetectable) for each must-sign PE.
 *   allowlist : { subjects:[], thumbprints:[] } approved signer identities.
 *   exclusions: [{ path, reason }] justified non-signed PEs (from classifyShippedPes).
 *   unjustified : string[] un-justified exclusions (block public).
 * signerApproved is injected to avoid a cycle; preflight passes the real one.
 * Returns { failures[], distributable, covered } — `covered` is the count of PEs
 * the public claim now spans (must-sign + justified exclusions).
 */
export function evaluatePayloadSigning({ channel, pes = [], allowlist = {}, exclusions = [], unjustified = [], signerApproved } = {}) {
  const failures = []
  if (channel !== 'public') {
    return { failures, distributable: false, covered: pes.length + exclusions.length }
  }
  for (const p of unjustified) {
    failures.push({ code: 'pe-exclusion-unjustified', detail: `shipped executable ${p} is excluded from signing without a written justification` })
  }
  for (const { path: p, signature } of pes) {
    if (!signature || !signature.valid) {
      failures.push({ code: 'pe-unsigned', detail: `shipped executable ${p} has no signtool-verifiable signature (status=${signature ? signature.status : 'absent'})` })
      continue
    }
    if (!signature.trustedTimestamp) {
      failures.push({ code: 'pe-untrusted-timestamp', detail: `shipped executable ${p} signature carries no trusted RFC3161 timestamp` })
    }
    if (typeof signerApproved === 'function' && !signerApproved(signature, allowlist)) {
      failures.push({ code: 'pe-publisher-not-approved', detail: `shipped executable ${p} signer ${signature.publisher || signature.thumbprint || 'unknown'} is not on the approved allowlist` })
    }
  }
  return { failures, distributable: failures.length === 0, covered: pes.length + exclusions.length }
}
