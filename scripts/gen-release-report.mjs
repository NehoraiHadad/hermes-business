// Emit the outer, tamper-evident release report AFTER packaging.
//
// Reads the manifest that gen-release-manifest embedded into the payload, measures
// the installer set, attempts to PROVE the installer's compressed payload actually
// contains that manifest (7z extraction if available; otherwise honestly
// not-proven), and writes release/release-report.json = { manifest, manifest_digest,
// installers, release_binding_digest, payload_binding }. The final verifier reads
// this report, recomputes both digests (tamper-evidence) and re-checks the bytes on
// disk. This never mutates the installer or signs anything.
//
//   node scripts/gen-release-report.mjs

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { repoRoot } from './lib/source-fingerprint.mjs'
import { unpackedDir } from './lib/build-attestation.mjs'
import { measureInstallers, selectInstaller } from './lib/release/gather.mjs'
import { buildReleaseReport } from './lib/release/manifest.mjs'
import { proveContainmentBound } from './lib/release/nsis-payload.mjs'
import { resolveReleaseTools } from './lib/release/tool-discovery.mjs'
import { classifyShippedPes, isPe } from './lib/release/pe-inventory.mjs'
import { extractAndVerifyPayloadPes, decidePayloadPeCoverage } from './lib/release/pe-containment.mjs'
import { verifySigntool } from './lib/release/signtool.mjs'
import { classifySignature, signerApproved } from './lib/release/signing.mjs'

const root = repoRoot()
const embeddedPath = path.join(unpackedDir(root), 'resources', 'release-manifest.json')
if (!existsSync(embeddedPath)) {
  console.error(`No embedded release-manifest.json at ${embeddedPath}; run gen-release-manifest during packing first.`)
  process.exit(1)
}
const embeddedJson = readFileSync(embeddedPath, 'utf8')
const manifest = JSON.parse(embeddedJson)
const installers = measureInstallers(root).map(i => ({ name: i.name, bytes: i.bytes, sha256: i.sha256 }))
if (!installers.length) {
  // The reason matters: release/ is not cleaned, so "none selected" is usually a
  // leftover installer whose name contains this version, not a missing build.
  console.error(`No installer .exe under release/: ${selectInstaller(root).errors.join('; ')}`)
  process.exit(1)
}

// TOOL WIRING: resolve the extractor by ABSOLUTE path (recursive electron-builder
// cache 7za, then vendored/PATH) and inject it into the containment extraction —
// no bare PATH name. Off-box (no extractor) the injection is null and containment
// is honestly not-proven (public fails closed), never faked.
const exists = p => { try { return !!p && existsSync(p) } catch { return false } }
const hashFile = p => { try { return createHash('sha256').update(readFileSync(p)).digest('hex') } catch { return null } }
const tools = resolveReleaseTools({
  localAppData: process.env.LOCALAPPDATA || null,
  vendorSigntool: path.join(root, 'node_modules', '@electron', 'windows-sign', 'vendor', 'signtool.exe'),
  exists,
  hashFile
})
const sevenZipPath = tools.sevenZip.chosen?.path || null

// Prove containment against the primary installer (there must be exactly one).
// CRITICAL 1: re-extract the manifest, the nonce-bearing attestation AND the
// app.asar from the payload and bind their exact bytes into a containment digest.
const primary = path.join(root, 'release', installers[0].name)
const unpacked = unpackedDir(root)
const attestationPath = path.join(unpacked, 'resources', 'build-attestation.json')
const attestationJson = existsSync(attestationPath) ? readFileSync(attestationPath, 'utf8') : null
const appAsarSha256 = manifest.app_asar?.sha256 ?? null
const payloadBinding = proveContainmentBound({
  installerPath: primary,
  ...(sevenZipPath ? { tool: sevenZipPath } : {}),
  expected: { manifestJson: embeddedJson, attestationJson, appAsarSha256 }
})
console.log(`Extractor: ${sevenZipPath ? `${tools.sevenZip.chosen.id} → ${sevenZipPath}` : 'none resolved (containment not provable off-box)'}`)

// CRITICAL 2 (final verifier): extract EVERY must-sign PE from the NSIS payload and
// re-verify the EXACT copies. Uses the ABSOLUTE resolved 7za + signtool; off-box
// (neither available) each PE is honestly not-extracted → not-proven and public
// fails closed. Never faked.
const signAllowlist = (() => { try { return JSON.parse(readFileSync(path.join(root, 'build', 'sign-allowlist.json'), 'utf8')) } catch { return { subjects: [], thumbprints: [], exclusions: [] } } })()
const loosePes = []
if (existsSync(unpacked)) {
  ;(function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (isPe(e.name)) loosePes.push(path.relative(unpacked, full).replace(/\\/g, '/'))
    }
  })(unpacked)
}
const mustSign = classifyShippedPes(loosePes, { allowlist: signAllowlist.exclusions || [] }).mustSign
const signtoolExe = tools.signtool.chosen?.path || null
const peTmp = path.join(root, 'build', 'pe-extract')
const extractTo = sevenZipPath
  ? (installerPath, inner) => {
      try {
        mkdirSync(peTmp, { recursive: true })
        const buf = execFileSync(sevenZipPath, ['e', '-so', installerPath, inner], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 30 })
        if (!buf || !buf.length) return null
        const out = path.join(peTmp, inner.replace(/[\\/]/g, '__'))
        writeFileSync(out, buf)
        return out
      } catch { return null }
    }
  : null
const probePe = signtoolExe && process.platform === 'win32'
  ? abs => classifySignature(verifySigntool(abs, { exe: signtoolExe }))
  : null
const extractedPes = extractAndVerifyPayloadPes({ installerPath: primary, mustSign, extractTo, probe: probePe })
const peCoverage = decidePayloadPeCoverage({ channel: 'public', mustSign, extracted: extractedPes, signerApproved, allowlist: signAllowlist })

const report = buildReleaseReport({ manifest, installers, payloadBinding })
report.payload_pe_verification = {
  scheme: 'pe-coverage-v1',
  must_sign_count: mustSign.length,
  extracted_count: extractedPes.filter(e => e.extracted).length,
  verified_count: peCoverage.covered,
  proven: peCoverage.proven,
  digest: peCoverage.digest,
  failures: peCoverage.failures.map(f => f.code)
}
console.log(`Payload PE re-verify: ${peCoverage.proven ? `PROVEN (${peCoverage.covered}/${mustSign.length})` : `NOT proven (${mustSign.length} must-sign; ${report.payload_pe_verification.extracted_count} extracted)`}`)
// HIGH 8: the report is written to a STAGING location (build/), never directly into
// release/. finalize-release.mjs promotes it into release/release-report.json inside
// the SAME atomic, gated, backup/rollback transaction as checksums + ACCEPTANCE, so
// a report can never appear next to sidecars that failed the final gate.
mkdirSync(path.join(root, 'build'), { recursive: true })
writeFileSync(path.join(root, 'build', 'release-report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(
  `Staged build/release-report.json (promoted atomically by finalize) — binding ${report.release_binding_digest.slice(0, 16)}…, ` +
    `payload_binding ${payloadBinding.proven ? 'PROVEN' : `NOT proven (${payloadBinding.reason})`}.`
)
if (!payloadBinding.proven) {
  console.log('  NOTE: installer↔payload containment could not be proven locally; the public gate will fail closed.')
}
