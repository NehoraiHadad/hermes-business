// AUTOMATED EXACT-ARTIFACT E2E CAPTURE — the single orchestrator lifecycle.
//
//   node scripts/e2e-exact-artifact.mjs [--channel public|qa|pilot]
//
// Channel-AGNOSTIC by design: the lifecycle it drives (scripts/e2e-installed-
// isolated.mjs — boot proof +, opt-in via HERMES_BUSINESS_E2E_APPROVAL=1, a real
// denied-approval probe over the official gateway RPC) runs against the REAL
// production transport with the isolated main-process QA-runtime override
// (electron/qa-runtime-policy.cjs — HERMES_HOME/port isolation only). It has NO
// dependency on the renderer demo transport / VITE_ALLOW_DEMO / `?demo=1`
// (grep confirms zero references anywhere under scripts/lib/isolated-e2e/ or
// scripts/lib/probes/installed/boot.mjs), so this stage needs no pilot-specific
// variant — it already proves exactly what a real production/pilot build needs.
//
// 1. Fingerprint the IMMUTABLE candidate package: installer sha256 (measured from the
//    packaged .exe bytes), build_nonce (from the embedded attestation) and the staged
//    release-binding digest — none hand-entered.
// 2. Launch/test the EXACT installed candidate via the isolated harness, injecting the
//    candidate build_nonce so the harness proves the RUNNING app echoed that exact
//    nonce (== the attested artifact).
// 3. Require the running_nonce non-empty AND equal to the candidate nonce.
// 4. MACHINE-write the packaged-e2e evidence by piping the assembled raw to
//    capture-evidence (stdin) — no manual fields. On any gap, write an honest BLOCKED
//    envelope and exit non-zero, so the package pipeline halts before finalization.

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { repoRoot } from './lib/source-fingerprint.mjs'
import { readAttestation, unpackedDir } from './lib/build-attestation.mjs'
import { measureCandidate, assessExactArtifactRun, selectVersionedInstaller } from './lib/release/exact-artifact.mjs'
import { parseJsonInput } from './lib/json-input.mjs'
import { parseChannel } from './lib/parse-channel.mjs'

const root = repoRoot()
const channel = parseChannel()
const node = process.execPath

function blockedAndExit(reason) {
  console.error(`e2e-exact-artifact: ${reason}`)
  spawnSync(node, [path.join(root, 'scripts', 'capture-evidence.mjs'), 'packaged-e2e', '--status', 'blocked', '--reason', reason], { stdio: 'inherit' })
  process.exit(1)
}

// ── 1. immutable candidate measurement ───────────────────────────────────────
const releaseDir = path.join(root, 'release')
const packageVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version
const selected = selectVersionedInstaller(existsSync(releaseDir) ? readdirSync(releaseDir) : [], packageVersion)
if (!selected.ok) blockedAndExit(selected.errors.join('; '))
const installerName = selected.name
const installerPath = path.join(releaseDir, installerName)
const installerSha256 = createHash('sha256').update(readFileSync(installerPath)).digest('hex')

const attestation = readAttestation(unpackedDir(root))
const buildNonce = attestation?.build_nonce || null

const stagedReport = path.join(root, 'build', 'release-report.json')
const promotedReport = path.join(releaseDir, 'release-report.json')
const reportJson = existsSync(stagedReport) ? readFileSync(stagedReport, 'utf8') : existsSync(promotedReport) ? readFileSync(promotedReport, 'utf8') : null
const releaseBindingDigest = (() => { try { return JSON.parse(reportJson).release_binding_digest || null } catch { return null } })()

const measured = measureCandidate({ installerSha256, buildNonce, releaseBindingDigest })
if (!measured.ok) blockedAndExit(`immutable candidate not measurable: ${measured.errors.join('; ')}`)
const candidate = measured.candidate
console.log(`Candidate: installer ${installerName} sha ${installerSha256.slice(0, 16)}…, nonce ${String(buildNonce).slice(0, 12)}…, binding ${String(releaseBindingDigest).slice(0, 16)}…`)

// ── 2. launch/test the EXACT installed candidate (isolated harness) ───────────
const run = spawnSync(node, [path.join(root, 'scripts', 'e2e-installed-isolated.mjs')], {
  cwd: root,
  env: { ...process.env, HERMES_EXACT_STAGED_ARTIFACT: candidate.build_nonce },
  encoding: 'utf8',
  maxBuffer: 1 << 26
})
// The harness emits ONE JSON object as its final stdout line (redaction-safe).
let harnessReport = null
try { harnessReport = parseJsonInput(run.stdout || '') } catch { /* handled below */ }
if (!harnessReport) blockedAndExit(`isolated harness produced no parseable report (exit ${run.status}). ${String(run.stderr || '').slice(0, 300)}`)

// ── 3+4. assess (nonce present + equal + exact artifact) and machine-write ────
const verdict = assessExactArtifactRun({ candidate, harnessReport })
if (!verdict.ok) {
  const detail = JSON.stringify({ error: harnessReport.error, artifact: harnessReport.artifact, approval: harnessReport.approval, teardown: harnessReport.teardown })
  blockedAndExit(`exact-artifact lifecycle not proven: ${verdict.errors.join('; ')}; report=${detail}`)
}

// TOCTOU: the installer must not have changed while the harness ran.
const installerShaNow = createHash('sha256').update(readFileSync(installerPath)).digest('hex')
if (installerShaNow !== installerSha256) blockedAndExit('installer bytes changed during the exact-artifact run (candidate no longer immutable).')

const cap = spawnSync(node, [path.join(root, 'scripts', 'capture-evidence.mjs'), 'packaged-e2e', '-'], {
  cwd: root,
  input: `${JSON.stringify(verdict.raw)}\n`,
  stdio: ['pipe', 'inherit', 'inherit']
})
if (cap.status !== 0) { console.error('e2e-exact-artifact: capture-evidence rejected the machine-captured raw.'); process.exit(1) }
const approvalCap = spawnSync(node, [path.join(root, 'scripts', 'capture-evidence.mjs'), 'approval', '--isolated', '-'], {
  cwd: root,
  input: `${JSON.stringify(verdict.raw)}\n`,
  stdio: ['pipe', 'inherit', 'inherit']
})
if (approvalCap.status !== 0) { console.error('e2e-exact-artifact: approval evidence rejected the isolated raw.'); process.exit(1) }
console.log(`Exact-artifact lifecycle PROVEN — running_nonce ${String(verdict.raw.running_nonce).slice(0, 12)}… == candidate; machine binding ${verdict.binding.capture_method}.`)
