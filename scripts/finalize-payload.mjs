// CRITICAL 2 — phase 2 of the two-phase Windows package: sign EVERY shipped PE,
// VERIFY each immediately, then embed the release manifest — all AFTER the `--win
// dir` build (afterPack's rcedit was the last PE mutation) and BEFORE NSIS packs.
//
//   node scripts/finalize-payload.mjs --channel public|qa|pilot
//
// public: requires a real cert (HERMES_SIGN_THUMBPRINT) + a resolved signtool +
//   an approved-publisher allowlist. Signs helpers/DLLs first, product exe last,
//   verifies each signed PE (valid + trusted RFC3161 timestamp + approved signer)
//   BEFORE embedding the manifest, and FAILS CLOSED (before NSIS) on any gap — an
//   unsigned build can never reach NSIS. Nothing is ever faked.
// qa: intentionally UNSIGNED — a labeled no-op; the manifest is still embedded so the
//   containment proof works, but the build stays NON-DISTRIBUTABLE downstream.
// pilot: ALSO intentionally UNSIGNED (no code-signing certificate exists yet) —
//   same no-op mechanics as qa, but the log line says so honestly as a Pilot/
//   Alpha statement, not a "non-distributable" one: pilot IS distributable
//   despite being unsigned (docs/specs/versioning.md §13 stage 5; the preflight
//   gate — scripts/lib/release/preflight.mjs — is what actually decides
//   distributability, not this script).

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { repoRoot, productExeName } from './lib/source-fingerprint.mjs'
import { unpackedDir } from './lib/build-attestation.mjs'
import { embedReleaseManifest } from './gen-release-manifest.mjs'
import { isPe } from './lib/release/pe-inventory.mjs'
import { signPayload } from './lib/release/sign-payload.mjs'
import { verifySigntool } from './lib/release/signtool.mjs'
import { classifySignature, signerApproved } from './lib/release/signing.mjs'
import { resolveReleaseTools } from './lib/release/tool-discovery.mjs'
import { parseChannel } from './lib/parse-channel.mjs'
import { isSigningTolerant } from './lib/release/channel-policy.mjs'

const root = repoRoot()
const channel = parseChannel()
const dir = unpackedDir(root)
if (!existsSync(dir)) fail(`release/win-unpacked missing — run \`electron-builder --win dir\` first.`)

function fail(msg) { console.error(`finalize-payload: ${msg}`); process.exit(1) }
function readJson(f) { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null } }

// Enumerate every shipped PE (POSIX-relative) under win-unpacked, helpers/DLLs first,
// the product exe last (signPayload enforces the order).
const listing = []
;(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name)
    if (e.isDirectory()) walk(full)
    else if (isPe(e.name)) listing.push(path.relative(dir, full).replace(/\\/g, '/'))
  }
})(dir)

const allowlist = readJson(path.join(root, 'build', 'sign-allowlist.json')) || { subjects: [], thumbprints: [], exclusions: [] }
const resolve = rel => path.join(dir, rel)

if (isSigningTolerant(channel)) {
  const plan = signPayload({ listing, resolve, signOne: null, exclusions: allowlist.exclusions || [] })
  if (channel === 'pilot') {
    console.log(`Pilot channel (Alpha prerelease): leaving ${plan.order.length} shipped PE(s) UNSIGNED — no code-signing certificate yet. This build IS distributable; Windows SmartScreen will warn on install and users should verify SHA256SUMS.txt (see docs/RELEASING.md). Embedding manifest.`)
  } else {
    console.log(`QA channel: leaving ${plan.order.length} shipped PE(s) UNSIGNED (non-distributable). Embedding manifest.`)
  }
  embedReleaseManifest(dir, root)
  console.log(`finalize-payload(${channel}): manifest embedded over unsigned payload.`)
  process.exit(0)
}

// ── public: fail-closed unless a real cert + resolved signtool are present ────
const exists = p => { try { return !!p && existsSync(p) } catch { return false } }
const hashFile = p => { try { return createHash('sha256').update(readFileSync(p)).digest('hex') } catch { return null } }
const tools = resolveReleaseTools({
  localAppData: process.env.LOCALAPPDATA || null,
  vendorSigntool: path.join(root, 'node_modules', '@electron', 'windows-sign', 'vendor', 'signtool.exe'),
  exists,
  hashFile
})
const signtoolExe = tools.signtool.chosen?.path || null
const thumbprint = process.env.HERMES_SIGN_THUMBPRINT
const timestampUrl = process.env.HERMES_SIGN_TSA || 'http://timestamp.digicert.com'

if (process.platform !== 'win32' || !signtoolExe) fail('no resolved signtool (vendored copy / PATH) — cannot sign payload for public (fail-closed, before NSIS).')
if (!thumbprint) fail('HERMES_SIGN_THUMBPRINT is not set — no approved code-signing certificate configured (fail-closed, before NSIS).')
if (!(allowlist.thumbprints?.length || allowlist.subjects?.length)) fail('build/sign-allowlist.json declares no approved publisher subject/thumbprint (fail-closed, before NSIS).')

console.log(`Using signtool: ${tools.signtool.chosen.id} → ${signtoolExe}`)
const signOne = absPath => execFileSync(signtoolExe, ['sign', '/sha1', thumbprint, '/fd', 'sha256', '/tr', timestampUrl, '/td', 'sha256', absPath], { stdio: 'inherit' })

let result
try {
  result = signPayload({ listing, resolve, signOne, exclusions: allowlist.exclusions || [] })
} catch (e) {
  fail(`payload signing aborted before NSIS: ${e.message}`)
}
if (result.unjustified.length) fail(`shipped PE(s) excluded from signing without justification: ${result.unjustified.join(', ')}`)
if (!result.signed) fail('no PE was signed (no signer) — refusing to proceed to NSIS.')

// Verify EVERY signed PE immediately, before the manifest is embedded / NSIS packs.
for (const rel of result.signedPaths) {
  const sig = classifySignature(verifySigntool(resolve(rel), { exe: signtoolExe }))
  if (!sig.valid || !sig.trustedTimestamp || !signerApproved(sig, allowlist)) {
    fail(`payload PE ${rel} did not verify after signing (valid=${sig.valid}, ts=${sig.trustedTimestamp}, approved=${signerApproved(sig, allowlist)}).`)
  }
  console.log(`  verified payload PE ${rel} — ${sig.publisher || sig.thumbprint}`)
}

// Manifest embed LAST so its recorded PE/app hashes describe the SIGNED bytes.
embedReleaseManifest(dir, root)
console.log(`finalize-payload(public): signed + verified ${result.signedPaths.length} payload PE(s); manifest embedded over signed bytes. Ready for NSIS.`)
