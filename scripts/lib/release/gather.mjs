// Impure workspace collector: reads the REAL working tree and release/ output and
// assembles the plain `state` object preflightRelease() decides over. All I/O lives
// here; the verdict logic stays pure and unit-tested elsewhere.

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { repoRoot, computeSourceFingerprint, currentHead, productExeName } from '../source-fingerprint.mjs'
import { readAttestation, unpackedDir } from '../build-attestation.mjs'
import { verifyEvidence } from '../../verify-evidence.mjs'
import { EVIDENCE_DIR } from '../evidence.mjs'
import { subjectFingerprint } from '../evidence-subject.mjs'
import { sha256, versionFromInstallerName } from './checksums.mjs'
import { inspectAsar } from './asar-index.mjs'
import { probeSignature } from './signtool.mjs'
import { dirtyReleaseInputs } from './porcelain.mjs'
import { createHash, verify as cryptoVerify } from 'node:crypto'
import { proveContainmentBound } from './nsis-payload.mjs'
import { classifyShippedPes, isPe } from './pe-inventory.mjs'
import { authenticateProvenance } from './provenance.mjs'
import { canonicalJson } from './binding.mjs'
import { resolveReleaseTools } from './tool-discovery.mjs'
import { selectVersionedInstaller } from './exact-artifact.mjs'
import { classifyProvenance } from '../git-provenance.mjs'

/** MEDIUM 9 / TOOL WIRING — resolve the deterministic bundled tools on THIS machine
 * via the ONE recursive validated resolver, preferring project-pinned vendor copies
 * over PATH. Advisory (never a standalone blocker): a missing extractor only makes
 * containment "not proven" and a missing signtool is subsumed by the cert
 * requirement. Returns { sevenZip, signtool } with absolute resolved paths. */
function discoverReleaseTools(root) {
  const exists = p => { try { return !!p && existsSync(p) } catch { return false } }
  const hash = p => { try { return sha256(readFileSync(p)) } catch { return null } }
  return resolveReleaseTools({
    localAppData: process.env.LOCALAPPDATA || null,
    vendorSigntool: path.join(root, 'node_modules', '@electron', 'windows-sign', 'vendor', 'signtool.exe'),
    exists,
    hashFile: hash
  })
}

/** Real ed25519/RSA detached-signature verifier keyed on committed trust-root PEMs. */
function makeLedgerVerifier(trustRoots) {
  const keys = trustRoots?.keys || {}
  return (body, signatureB64, keyId) => {
    const pem = keys[keyId]
    if (!pem || !signatureB64) return false
    try { return cryptoVerify(null, Buffer.from(body, 'utf8'), pem, Buffer.from(String(signatureB64), 'base64')) } catch { return false }
  }
}

/** Authenticate a ledger's provenance against committed trust roots; returns the
 * ledger only if authentic (so an unauthenticated ledger is treated as ABSENT). */
function authenticateLedger(ledger, trustRoots) {
  if (!ledger) return { ledger: null, auth: { authenticated: false, reason: 'no-ledger' } }
  const body = canonicalJson({ ...ledger, signature: undefined })
  const auth = authenticateProvenance({ artifact: ledger, trustRoots: trustRoots || {}, verifySignature: makeLedgerVerifier(trustRoots), body })
  return { ledger: auth.authenticated ? ledger : null, auth }
}

/** Recursively collect POSIX-relative paths of every shipped PE under `base`. */
function walkPes(dir, base = dir, out = []) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walkPes(full, base, out)
    else if (isPe(e.name)) out.push(path.relative(base, full).replace(/\\/g, '/'))
  }
  return out
}

function git(args, root, encoding = 'utf8') {
  return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString(encoding)
}

/** Uncommitted release-blocking inputs via the robust -z parser + registry. */
export function dirtyInputs(root) {
  let buf
  try {
    buf = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ['<git unavailable — cannot prove a clean tree>']
  }
  return dirtyReleaseInputs(buf.toString('utf8'))
}

function headSubject(root) {
  try { return git(['log', '-1', '--format=%s'], root).trim() } catch { return '' }
}

/** Installer .exe files in release/ (excludes blockmaps). */
export function measureInstallers(root) {
  const dir = path.join(root, 'release')
  if (!existsSync(dir)) return []
  const version = readJson(path.join(root, 'package.json'))?.version || ''
  const selected = selectVersionedInstaller(readdirSync(dir), version)
  if (!selected.ok) return []
  return [selected.name]
    .map(name => {
      const buf = readFileSync(path.join(dir, name))
      return { name, version: versionFromInstallerName(name), bytes: buf.length, sha256: sha256(buf) }
    })
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

/** Read every evidence envelope: per-category status, counts, and the packaged-e2e
 * build binding + per-category subject_fingerprint digests. */
function evidenceFacts(root) {
  const statuses = {}, counts = {}, digests = {}
  let packagedBinding = null
  try {
    for (const f of readdirSync(EVIDENCE_DIR)) {
      if (!f.endsWith('.json') || f === 'schema.json') continue
      const env = readJson(path.join(EVIDENCE_DIR, f))
      if (!env || !env.category) continue
      counts[env.category] = (counts[env.category] || 0) + 1
      statuses[env.category] = env.status
      if (env.subject_fingerprint) digests[env.category] = env.subject_fingerprint
      if (env.category === 'packaged-e2e') {
        const s = env.summary || {}
        packagedBinding = { build_nonce: s.build_nonce, release_binding_digest: s.release_binding_digest, installer_sha256: s.installer_sha256, capture_method: s.capture_method }
      }
    }
  } catch { /* dir missing → empty; preflight fails closed on absent gates */ }
  return { statuses, counts, digests, packagedBinding }
}

function currentEvidenceDigests(root) {
  const out = {}
  for (const cat of ['packaged-e2e', 'approval', 'shared-state', 'thin-installer']) {
    try { out[cat] = subjectFingerprint(root, cat).fingerprint } catch { /* missing subject */ }
  }
  return out
}

/** Assemble the full preflight state from the working tree. */
export function gatherReleaseState({ root = repoRoot(), channel = 'public', probe = true, checksumsOverride = null, reportOverride = null } = {}) {
  const pkg = readJson(path.join(root, 'package.json')) || {}
  const dir = unpackedDir(root)
  const attestation = readAttestation(dir)
  const installers = measureInstallers(root)
  const asarPath = path.join(dir, 'resources', 'app.asar')
  const asar = inspectAsar(asarPath)
  let appAsar = null
  if (asar.valid && existsSync(asarPath)) {
    const buf = readFileSync(asarPath)
    appAsar = { bytes: buf.length, sha256: sha256(buf) }
  }
  const exeName = productExeName(root)
  const doProbe = probe && process.platform === 'win32'

  // MEDIUM 9 / TOOL WIRING: resolve the bundled tools FIRST (recursive cache 7za,
  // vendored signtool) so their absolute paths are injected into EVERY signtool
  // verification and the containment extraction below — never a bare PATH name.
  const tools = discoverReleaseTools(root)
  const signtoolExe = tools.signtool.chosen?.path || null
  // No resolved signtool → do NOT fall back to a bare PATH name (avoids a PATH-only
  // false positive); the probe is simply not performed and reported as unknown.
  const probeSig = file => (signtoolExe ? probeSignature(file, { exe: signtoolExe }) : null)

  const signatures = doProbe
    ? {
        installer: installers[0] ? probeSig(path.join(root, 'release', installers[0].name)) : null,
        app: existsSync(path.join(dir, exeName)) ? probeSig(path.join(dir, exeName)) : null
      }
    : { installer: null, app: null }

  // CRITICAL 2: enumerate EVERY shipped PE (product exe, resources/elevate.exe,
  // runtime DLLs, native .node) plus the installer, classify against the justified
  // exclusion allowlist, and probe each must-sign PE. The public claim spans them
  // all — an unsigned elevate.exe or DLL fails public closed.
  const signAllowlistFile = readJson(path.join(root, 'build', 'sign-allowlist.json')) || { subjects: [], thumbprints: [], exclusions: [] }
  const listing = existsSync(dir) ? walkPes(dir) : []
  for (const i of installers) listing.push(i.name)
  const peClass = classifyShippedPes(listing, { allowlist: signAllowlistFile.exclusions || [] })
  const resolvePe = rel => installers.some(i => i.name === rel) ? path.join(root, 'release', rel) : path.join(dir, rel)
  const payloadSigning = {
    pes: peClass.mustSign.map(rel => ({ path: rel, signature: doProbe ? probeSig(resolvePe(rel)) : null })),
    exclusions: peClass.excluded,
    unjustified: peClass.unjustified,
    inventory: peClass.all
  }
  const evidence = evidenceFacts(root)
  // HIGH 8: finalize gates over the STAGED report (build/release-report.json) before
  // it is promoted into release/; verify-release-contract reads the promoted one.
  const releaseReport = reportOverride || readJson(path.join(root, 'release', 'release-report.json'))
  const embeddedManifest = readJson(path.join(dir, 'resources', 'release-manifest.json'))

  // CRITICAL 1: the verifier re-runs containment extraction ITSELF over the
  // installer bytes on disk — it never trusts the report's payload_binding boolean.
  // Off-box (no 7z-family extractor) this is an honest not-proven that fails the
  // public gate closed; it is never faked. Prefer the discovered cache 7za; fall
  // back to find7z's PATH probe when discovery found none.
  const independentContainment = installers[0] && existsSync(path.join(dir, 'resources', 'release-manifest.json'))
    ? proveContainmentBound({
        installerPath: path.join(root, 'release', installers[0].name),
        ...(tools.sevenZip.chosen ? { tool: tools.sevenZip.chosen.path } : {}),
        expected: {
          manifestJson: readFileSync(path.join(dir, 'resources', 'release-manifest.json'), 'utf8'),
          attestationJson: existsSync(path.join(dir, 'resources', 'build-attestation.json'))
            ? readFileSync(path.join(dir, 'resources', 'build-attestation.json'), 'utf8')
            : null,
          appAsarSha256: appAsar?.sha256 ?? null
        }
      })
    : { proven: false, method: 'none', reason: 'no-installer-or-embedded-manifest', digest: null, extracted: null }
  const build = {
    build_nonce: attestation?.build_nonce ?? null,
    release_binding_digest: releaseReport?.release_binding_digest ?? null,
    installer_sha256: installers[0]?.sha256 ?? null
  }
  const head = currentHead(root)
  const attestationProvenance = classifyProvenance(attestation?.source_head, head, { git, cwd: root })
  return {
    channel,
    productName: pkg.build?.productName || pkg.name,
    packageVersion: pkg.version,
    currentHead: head,
    attestationProvenance,
    currentFingerprint: computeSourceFingerprint(root).fingerprint,
    headSubject: headSubject(root),
    dirtyInputs: dirtyInputs(root),
    attestation,
    installers,
    checksums: checksumsOverride || readJson(path.join(root, 'release', 'checksums.json')),
    asar,
    signatures,
    payloadSigning,
    signAllowlist: signAllowlistFile,
    ...(() => {
      const trustRoots = readJson(path.join(root, 'build', 'trust-roots.json')) || {}
      const rawLedger = readJson(path.join(root, 'release-ledger.json'))
      const { ledger, auth } = authenticateLedger(rawLedger, trustRoots)
      return { trustRoots, rawLedger, ledger, ledgerAuth: auth }
    })(),
    lockAttest: readJson(path.join(root, 'release', 'lock-attest.json')),
    currentLockSha256: (() => { try { return sha256(readFileSync(path.join(root, 'package-lock.json'))) } catch { return null } })(),
    releaseReport,
    independentContainment,
    tools,
    build,
    observed: { version: pkg.version, installers, appAsar, attestation, evidenceDigests: currentEvidenceDigests(root), embeddedManifest },
    evidence: { ok: verifyEvidence().ok, statuses: evidence.statuses, counts: evidence.counts, packagedBinding: evidence.packagedBinding },
    probed: doProbe
  }
}
