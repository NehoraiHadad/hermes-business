// CRITICAL 2 — pre-NSIS signing orchestration (pure plan + injectable runner).
//
// The order incident: electron-builder's `win.signAndEditExecutable=false` disabled
// its own per-file signing, so NOTHING inside win-unpacked was signed; the installer
// was then compressed around unsigned executables. The correct order is:
//   1. app.asar + attestation + manifest are already in win-unpacked (afterPack),
//   2. sign EVERY shipped PE (helpers/DLLs first, the product exe last) BEFORE NSIS
//      compresses the payload,
//   3. NSIS packs the now-signed copies,
//   4. the installer itself is signed post-NSIS (sign-release.mjs),
//   5. the verifier re-extracts and checks the copies actually inside the installer.
//
// This module owns steps 2's PLAN (pure, ordered) and drives an INJECTED `signOne`
// runner so tests exercise the order/coverage without a certificate. With no signer
// configured it signs NOTHING and returns a truthful { signed:false, ... } — it
// never fabricates a signature, so the public gate stays fail-closed.

import { classifyShippedPes } from './pe-inventory.mjs'

/**
 * Deterministic signing order over the must-sign set: inner artifacts (helpers,
 * DLLs, native addons) first, the top-level product .exe LAST so a partial failure
 * never leaves a signed shell around unsigned innards. Pure.
 *   listing   : POSIX-relative PE paths inside win-unpacked
 *   exclusions: [{ path, reason }] justified non-signed PEs
 * Returns { order:string[], excluded, unjustified }.
 */
export function planSigning(listing = [], { exclusions = [] } = {}) {
  const { mustSign, excluded, unjustified } = classifyShippedPes(listing, { allowlist: exclusions })
  const isTopExe = p => /\.exe$/i.test(p) && !p.includes('/')
  const order = [...mustSign].sort((a, b) => {
    const ax = isTopExe(a) ? 1 : 0
    const bx = isTopExe(b) ? 1 : 0
    if (ax !== bx) return ax - bx // top-level exe(s) last
    return a.localeCompare(b)
  })
  return { order, excluded, unjustified }
}

/**
 * Drive signing over the planned order.
 *   listing    : PE paths in win-unpacked
 *   resolve    : (relPath) => absolute path on disk
 *   signOne    : (absPath) => void  — the real signer (signtool sign …); when null,
 *                NOTHING is signed and we return signed:false (honest, never faked).
 *   exclusions : justified non-signed PEs
 *   log        : console-like
 * Returns { signed:boolean, order, signedPaths, excluded, unjustified, reason? }.
 */
export function signPayload({ listing = [], resolve = p => p, signOne = null, exclusions = [], log = console } = {}) {
  const { order, excluded, unjustified } = planSigning(listing, { exclusions })
  if (typeof signOne !== 'function') {
    log.log(`[sign-payload] NO signer configured — leaving ${order.length} shipped executable(s) UNSIGNED (public gate will fail closed):`)
    for (const p of order) log.log(`   - ${p}`)
    return { signed: false, order, signedPaths: [], excluded, unjustified, reason: 'no-signer-configured' }
  }
  const signedPaths = []
  for (const rel of order) {
    signOne(resolve(rel)) // throws → aborts before NSIS; caller must not proceed
    signedPaths.push(rel)
  }
  log.log(`[sign-payload] signed ${signedPaths.length} shipped executable(s) before NSIS: ${signedPaths.join(', ')}`)
  return { signed: true, order, signedPaths, excluded, unjustified }
}
