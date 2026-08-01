// Sign every distributable EXE, then VERIFY each one — fail-closed.
//
// Public distribution requires that all shipped executables (the installer AND the
// app exe inside win-unpacked, which the installer carries) are Authenticode-signed
// by an APPROVED publisher with a trusted RFC3161 timestamp, and that each verifies
// under `signtool verify /pa /tw`. We do NOT assume a certificate exists: signing
// needs a real cert (thumbprint via HERMES_SIGN_THUMBPRINT) and signtool on PATH.
// Absent either, public FAILS CLOSED here — the pipeline stops before checksums, so
// an unsigned build can never be checksummed/accepted as distributable.
//
// QA: intentionally unsigned. This step is a labeled no-op so a QA package can be
// produced, but downstream it is marked NON-DISTRIBUTABLE.
//
//   node scripts/sign-release.mjs --channel public|qa

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { repoRoot, productExeName } from './lib/source-fingerprint.mjs'
import { unpackedDir } from './lib/build-attestation.mjs'
import { verifySigntool } from './lib/release/signtool.mjs'
import { classifySignature, signerApproved } from './lib/release/signing.mjs'
import { resolveReleaseTools } from './lib/release/tool-discovery.mjs'
import { measureInstallers } from './lib/release/gather.mjs'

const root = repoRoot()
const channel = process.argv.includes('--channel') ? process.argv[process.argv.indexOf('--channel') + 1] : 'public'

if (channel === 'qa') {
  console.log('QA channel: leaving EXEs UNSIGNED (non-distributable by policy). No signing performed.')
  process.exit(0)
}

const thumbprint = process.env.HERMES_SIGN_THUMBPRINT
const timestampUrl = process.env.HERMES_SIGN_TSA || 'http://timestamp.digicert.com'
const allowlist = readJson(path.join(root, 'build', 'sign-allowlist.json')) || { subjects: [], thumbprints: [] }

function readJson(f) { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null } }

// TOOL WIRING: resolve signtool by ABSOLUTE path (vendored @electron/windows-sign
// copy, then a PATH signtool resolved to its full path) so both the sign call AND the
// read-only verify invoke the exact same validated binary — never a bare PATH name
// that could differ between steps or be a PATH-only false positive.
const exists = p => { try { return !!p && existsSync(p) } catch { return false } }
const hashFile = p => { try { return createHash('sha256').update(readFileSync(p)).digest('hex') } catch { return null } }
const tools = resolveReleaseTools({
  localAppData: process.env.LOCALAPPDATA || null,
  vendorSigntool: path.join(root, 'node_modules', '@electron', 'windows-sign', 'vendor', 'signtool.exe'),
  exists,
  hashFile
})
const signtoolExe = tools.signtool.chosen?.path || null

if (process.platform !== 'win32' || !signtoolExe) {
  fail('signtool is not available (no vendored copy, none resolved on PATH) — cannot sign for public distribution (fail-closed; no cert assumed).')
}
console.log(`Using signtool: ${tools.signtool.chosen.id} → ${signtoolExe}`)
if (!thumbprint) {
  fail('HERMES_SIGN_THUMBPRINT is not set — no approved code-signing certificate configured (fail-closed).')
}
if (!allowlist.thumbprints.length && !allowlist.subjects.length) {
  fail('build/sign-allowlist.json declares no approved publisher subject/thumbprint (fail-closed).')
}

const exeDir = unpackedDir(root)
const targets = [
  path.join(exeDir, productExeName(root)),
  ...measureInstallers(root).map(item => path.join(root, 'release', item.name))
].filter(existsSync)

for (const exe of targets) {
  try {
    execFileSync(signtoolExe, ['sign', '/sha1', thumbprint, '/fd', 'sha256', '/tr', timestampUrl, '/td', 'sha256', exe], { stdio: 'inherit' })
  } catch (e) {
    fail(`signing failed for ${path.basename(exe)}: ${e.message}`)
  }
  const sig = classifySignature(verifySigntool(exe, { exe: signtoolExe }))
  if (!sig.valid || !sig.trustedTimestamp || !signerApproved(sig, allowlist)) {
    fail(`post-sign verify failed for ${path.basename(exe)} (valid=${sig.valid}, ts=${sig.trustedTimestamp}, approved=${signerApproved(sig, allowlist)}).`)
  }
  console.log(`signed + verified ${path.basename(exe)} — ${sig.publisher || sig.thumbprint}`)
}
console.log(`All ${targets.length} distributable EXE(s) signed by an approved publisher and signtool-verified.`)

function fail(msg) {
  console.error(`sign-release: ${msg}`)
  process.exit(1)
}
