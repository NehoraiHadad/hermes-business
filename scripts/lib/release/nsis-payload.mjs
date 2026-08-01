// Prove (or honestly refuse to prove) that a packaged NSIS installer CONTAINS the
// canonical release manifest that was embedded into win-unpacked before packaging.
//
// The auditor's finding: a binding computed over the LOOSE win-unpacked tree does
// not prove the installer's compressed payload holds those same bytes. The only
// way to prove containment is to look INSIDE the installer. electron-builder's NSIS
// output is a 7-Zip-compressed SFX, so `7z` can list/extract it. If a 7z-family
// extractor is available we extract `resources/release-manifest.json` from the
// payload and compare it byte-for-byte to the expected manifest. If NOT available
// (as on this dev box) we DO NOT fake a pass — we return { proven:false,
// reason:'no-nsis-extractor' } and the public gate fails closed. Being explicit
// about what cannot be proven is the whole point.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'

const CANDIDATE_TOOLS = [
  '7z', '7za',
  'C:/Program Files/7-Zip/7z.exe',
  'C:/Program Files (x86)/7-Zip/7z.exe'
]

/** Locate a 7-Zip-family extractor, or null. `probe` is injectable for tests. */
export function find7z(probe = defaultProbe) {
  for (const tool of CANDIDATE_TOOLS) {
    if (probe(tool)) return tool
  }
  return null
}

function defaultProbe(tool) {
  if (tool.includes('/') || tool.includes('\\')) return existsSync(tool)
  try {
    execFileSync(tool, ['i'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Prove the installer contains `expectedManifestJson` (canonical JSON string).
 *   installerPath : the packaged .exe
 *   extractEntry  : (installerPath, innerPath) => string  — returns the extracted
 *                   file's UTF-8 content; injectable (default shells to 7z).
 *   tool          : extractor path from find7z() | null
 * Returns { proven, method, reason }. Never throws; a failed extraction is an
 * honest not-proven, never a crash-into-pass.
 */
export function proveContainment({ installerPath, expectedManifestJson, tool = find7z(), extractEntry = defaultExtract } = {}) {
  if (!tool) return { proven: false, method: 'none', reason: 'no-nsis-extractor' }
  let content
  try {
    content = extractEntry(installerPath, 'resources/release-manifest.json', tool)
  } catch (e) {
    return { proven: false, method: '7z', reason: `extract-failed: ${e.message}` }
  }
  if (content == null) return { proven: false, method: '7z', reason: 'manifest-not-in-payload' }
  const norm = s => String(s).replace(/\r\n/g, '\n').trim()
  if (norm(content) !== norm(expectedManifestJson)) {
    return { proven: false, method: '7z', reason: 'payload-manifest-differs' }
  }
  return { proven: true, method: '7z', reason: '' }
}

function defaultExtract(installerPath, innerPath, tool) {
  // `7z e -so` streams the named entry to stdout without touching disk.
  return execFileSync(tool, ['e', '-so', installerPath, innerPath], { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8')
}

// ---- CRITICAL 1: independently BOUND containment ----------------------------
//
// A single boolean (`payload_binding.proven`) recorded on the report is only ever
// worth as much as who wrote it — an operator (or a bug) can flip it to true. The
// only trustworthy proof is one the FINAL verifier re-derives itself: re-extract
// the embedded facts (manifest bytes, attestation bytes, app.asar bytes) FROM the
// installer, hash each, and fold them into a single containment digest bound to
// the exact extracted bytes. The verifier then requires (a) its own independent
// extraction to succeed and be byte-equal to what the loose payload claims, and
// (b) the report's recorded digest to equal the one it just recomputed. A toggled
// boolean with no real extraction, or a digest that disagrees with the bytes
// actually inside the installer, fails closed. Report fields alone are never trusted.

export const CONTAINMENT_SCHEME = 1

const PAYLOAD_ENTRIES = {
  manifest: 'resources/release-manifest.json',
  attestation: 'resources/build-attestation.json'
}

function sha256Hex(s) {
  return createHash('sha256').update(Buffer.isBuffer(s) ? s : Buffer.from(String(s), 'utf8')).digest('hex')
}

/** Canonical digest over the EXACT extracted payload facts (order-independent,
 * scheme-versioned so an extraction-scheme change stops matching old digests). */
export function containmentDigest(extracted = {}) {
  const parts = {
    scheme: CONTAINMENT_SCHEME,
    manifest_sha256: extracted.manifest_sha256 || null,
    attestation_sha256: extracted.attestation_sha256 || null,
    app_asar_sha256: extracted.app_asar_sha256 || null
  }
  return sha256Hex(
    Object.keys(parts).sort().map(k => `${k}=${parts[k]}`).join('\n')
  )
}

/**
 * Extract the embedded facts from the installer and bind them.
 *   installerPath : the packaged .exe
 *   expected      : { manifestJson, attestationJson, appAsarSha256 } — the loose
 *                   win-unpacked facts the report claims are inside. Each extracted
 *                   entry is compared byte-for-byte (manifest/attestation) or by
 *                   sha256 (app.asar) to its expectation; any drift fails closed.
 *   extractEntry  : (installerPath, innerPath, tool) => utf8-string|null
 *   extractBinary : (installerPath, innerPath, tool) => Buffer|null (for app.asar)
 * Returns { proven, method, reason, digest, extracted, mismatches }.
 * Never throws; a failed extraction is an honest not-proven, never a crash-to-pass.
 */
export function proveContainmentBound({ installerPath, expected = {}, tool = find7z(), extractEntry = defaultExtract, extractBinary = defaultExtractBinary } = {}) {
  if (!tool) return notProven('no-nsis-extractor', 'none')
  const norm = s => String(s).replace(/\r\n/g, '\n').trim()
  const mismatches = []
  const extracted = { manifest_sha256: null, attestation_sha256: null, app_asar_sha256: null }

  // 1. release-manifest.json — must be present and byte-equal to the expectation.
  let manifest
  try {
    manifest = extractEntry(installerPath, PAYLOAD_ENTRIES.manifest, tool)
  } catch (e) {
    return notProven(`extract-failed: ${e.message}`, '7z')
  }
  if (manifest == null) return notProven('manifest-not-in-payload', '7z')
  if (expected.manifestJson != null && norm(manifest) !== norm(expected.manifestJson)) {
    mismatches.push('manifest')
  }
  extracted.manifest_sha256 = sha256Hex(norm(manifest))

  // 2. build-attestation.json — the nonce-bearing attestation must ALSO be inside
  //    the payload and match, so the app that echoes the nonce is the packaged one.
  if (expected.attestationJson != null) {
    let att
    try {
      att = extractEntry(installerPath, PAYLOAD_ENTRIES.attestation, tool)
    } catch (e) {
      return notProven(`extract-failed: ${e.message}`, '7z')
    }
    if (att == null) return notProven('attestation-not-in-payload', '7z')
    if (norm(att) !== norm(expected.attestationJson)) mismatches.push('attestation')
    extracted.attestation_sha256 = sha256Hex(norm(att))
  }

  // 3. app.asar — extract the ACTUAL archive from the payload and hash it, so the
  //    manifest's claimed app_asar.sha256 is proven against the bytes really shipped.
  if (expected.appAsarSha256 != null) {
    let asarBuf
    try {
      asarBuf = extractBinary(installerPath, 'resources/app.asar', tool)
    } catch (e) {
      return notProven(`extract-failed: ${e.message}`, '7z')
    }
    if (asarBuf == null) return notProven('app-asar-not-in-payload', '7z')
    extracted.app_asar_sha256 = sha256Hex(asarBuf)
    if (extracted.app_asar_sha256 !== expected.appAsarSha256) mismatches.push('app.asar')
  }

  if (mismatches.length) {
    return { proven: false, method: '7z', reason: `payload-facts-differ: ${mismatches.join(',')}`, digest: containmentDigest(extracted), extracted, mismatches }
  }
  return { proven: true, method: '7z', reason: '', digest: containmentDigest(extracted), extracted, mismatches: [] }
}

function notProven(reason, method) {
  return { proven: false, method, reason, digest: null, extracted: null, mismatches: [] }
}

function defaultExtractBinary(installerPath, innerPath, tool) {
  return execFileSync(tool, ['e', '-so', installerPath, innerPath], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 30 })
}
