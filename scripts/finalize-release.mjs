// Atomically finalize the official release sidecars — checksums + acceptance —
// ONLY after the full release contract passes over the STAGED artifacts.
//
// Package order (see package.json package:win) runs this LAST. It:
//   1. measures the installer set and fingerprints each installer (TOCTOU guard),
//   2. writes checksums.json / SHA256SUMS.txt / ACCEPTANCE.md into a fresh,
//      symlink-verified staging dir on the same volume as release/,
//   3. runs the fail-closed preflight with the STAGED checksums injected (so the
//      gate judges what we are about to promote, not a pre-existing file),
//   4. promotes all sidecars atomically iff the gate passes AND no installer
//      mutated mid-run; on any failure NOTHING is promoted and the prior official
//      sidecars are left untouched.
//
//   node scripts/finalize-release.mjs [--channel public|qa|pilot]

import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { repoRoot } from './lib/source-fingerprint.mjs'
import { gatherReleaseState, measureInstallers, selectInstaller } from './lib/release/gather.mjs'
import { preflightRelease } from './lib/release/preflight.mjs'
import { computeReleaseBinding } from './lib/release/binding.mjs'
import { makeStaging, stageSidecar, fingerprintCandidate, finalizeSidecars, recoverRelease } from './lib/release/staging.mjs'
import { parseChannel } from './lib/parse-channel.mjs'
import { requiresFullRigor } from './lib/release/channel-policy.mjs'
import { prepareUpdateManifest, UPDATE_MANIFEST_FILE } from './lib/release/update-signing.mjs'

const root = repoRoot()
const channel = parseChannel()
const releaseDir = path.join(root, 'release')
if (!existsSync(releaseDir)) { console.error('No release/ directory; package first.'); process.exit(1) }

// CRASH-SAFE PROMOTION: heal any promotion interrupted by a previous crash BEFORE
// doing anything else. An unreadable journal throws (we never guess); a clean tree
// is a no-op. This is the "recovery on next launch" step.
const recovered = recoverRelease(releaseDir)
if (recovered.recovered) {
  console.log(`Recovered a prior interrupted promotion: ${recovered.action} (${recovered.files.join(', ') || 'no files'}).`)
}

const installers = measureInstallers(root)
if (!installers.length) {
  // Never just "no installer" — release/ is not cleaned between runs, so the usual
  // cause is an OLD installer whose name contains the new version string.
  console.error(`No installer .exe under release/: ${selectInstaller(root).errors.join('; ')}`)
  process.exit(1)
}

// Checksums content (the manifest the contract verifies) + human table.
const entries = installers.map(e => ({ name: e.name, bytes: e.bytes, sha256: e.sha256 }))
const checksums = { generated_from: 'release/', installers: entries }
const table = entries.map(e => `${e.sha256}  ${String(e.bytes).padStart(12)}  ${e.name}`).join('\n')

// HIGH 8: the release report was STAGED to build/ (never written into release/).
// Gate over it here and promote it in the same transaction as checksums/acceptance.
const stagedReportPath = path.join(root, 'build', 'release-report.json')
const stagedReportJson = existsSync(stagedReportPath) ? readFileSync(stagedReportPath, 'utf8') : null
const reportOverride = stagedReportJson ? JSON.parse(stagedReportJson) : null
// public AND pilot are full-rigor channels (channel-policy.mjs) — both require
// the binding-chain report to exist before anything can be finalized. qa does not.
if (requiresFullRigor(channel) && !reportOverride) { console.error('No staged build/release-report.json; run gen-release-report first.'); process.exit(1) }

// Gate over the STAGED checksums + STAGED report (public/pilot: full contract;
// qa: signing non-blocking). Signature probing only makes sense for public —
// qa/pilot never carry a cert, so skip it there too.
const state = gatherReleaseState({ root, channel, probe: channel === 'public', checksumsOverride: checksums, reportOverride })
const verdict = preflightRelease(state)
// These codes only ever fire when evaluateSigning ran its per-item loop, which
// only happens for channel === 'public' (signing.mjs) — so for qa/pilot they can
// never actually appear. Filtered anyway as a defensive, explicit statement of
// intent rather than relying on that invariant silently.
const SIGNING_NONBLOCKING = new Set(['unsigned-public', 'untrusted-timestamp-public', 'publisher-not-approved', 'unknown-channel'])
const blocking = channel !== 'public' ? verdict.failures.filter(f => !SIGNING_NONBLOCKING.has(f.code)) : verdict.failures
const gatePassed = blocking.length === 0

// ---- Runtime update trust anchor (update-manifest.json) ---------------------
// The in-app one-click updater cannot lean on the build-time ledger:
// build/trust-roots.json is RETROSPECTIVE (it can only pin versions that already
// shipped), so an installed v0.4.0-alpha.7 has no way to know anything about the
// v0.4.0-alpha.8 it is being offered. The trust anchor for the RUNTIME is instead
// a stable public key compiled into the app plus this per-release signed
// statement over the installer's digest.
//
// POLICY (deliberate, and deliberately loud):
//   * a missing manifest does NOT hard-block the release. There is no signing key
//     in CI yet and pilot must keep shipping; blocking would only tempt someone to
//     disable the check. What it must never be is SILENT — the omission is printed
//     as a warning here AND recorded in the acceptance appendix, so "this release
//     has no runtime update trust anchor" is a stated fact, not an absence nobody
//     notices.
//   * it is never present-and-unsigned. A placeholder would train the updater (and
//     us) to accept an unsigned statement, which is the entire attack.
//   * a manifest that exists but does not verify, or whose installer digest
//     disagrees with checksums.json / release-ledger.json, is a HARD failure:
//     nothing is promoted. Three independent records of one file that disagree
//     mean the release tree is not the one we think we cut.
const updateManifest = prepareUpdateManifest({ root, version: state.packageVersion, channel, checksums, ledger: state.rawLedger })
if (updateManifest.status === 'invalid') {
  console.error(`Refusing to finalize: update manifest is invalid [${updateManifest.code}] ${updateManifest.detail}\n` +
    `Nothing was promoted. Fix or delete release/${UPDATE_MANIFEST_FILE} and re-run.`)
  process.exit(1)
}
if (updateManifest.status === 'absent') {
  console.warn(`WARNING: no signed ${UPDATE_MANIFEST_FILE} for this release (${updateManifest.detail}).\n` +
    '  The in-app updater will have NO cryptographic trust anchor for this version and must refuse to auto-install it.\n' +
    '  Generate a key with `node scripts/gen-update-key.mjs`, paste its public key into electron/update-trust.cjs, rebuild, and re-run.')
} else {
  console.log(`Update manifest ${updateManifest.status}: ${updateManifest.detail}`)
}
const updateAnchorLine = updateManifest.status === 'absent'
  ? `ABSENT — no runtime update trust anchor (${updateManifest.detail}); the in-app updater must refuse this version`
  : `PRESENT (${updateManifest.status}) — signed by \`${updateManifest.keyId}\`, ${updateManifest.detail}`

// Acceptance report body (canonical doc + artifact-bound appendix).
const binding = state.releaseReport?.release_binding_digest
  ? { digest: state.releaseReport.release_binding_digest }
  : computeReleaseBinding({ installers: state.installers, attestation: state.attestation, checksums, head: state.currentHead, subject: state.headSubject })
const canonicalDoc = readFileSync(path.join(root, 'docs', 'ACCEPTANCE.md'), 'utf8').replace(/\r\n/g, '\n').trimEnd()
const digestRows = entries.map(e => `| \`${e.name}\` | ${e.bytes.toLocaleString('en-US')} | \`${e.sha256}\` |`).join('\n')
const acceptance = `${canonicalDoc}\n\n\n---\n\n## Appendix A — Build artifacts (LOCAL, generated, artifact-bound)\n\n` +
  `- **Release binding digest:** \`${binding.digest}\`\n` +
  `- **App version:** \`${state.packageVersion}\`  •  **Channel:** \`${channel}\`  •  **Distributable:** \`${verdict.distributable}\`\n` +
  `- **Version immutability:** ${verdict.immutability?.label || 'n/a'}\n` +
  `- **Installer↔payload binding:** ${state.releaseReport?.payload_binding?.proven ? 'PROVEN' : `NOT proven (${state.releaseReport?.payload_binding?.reason || 'no report'})`}\n` +
  `- **Signed update manifest:** ${updateAnchorLine}\n\n` +
  `| Installer | Bytes | SHA-256 |\n|---|---|---|\n${digestRows}\n`

// Stage, then promote all-or-nothing.
const stagingDir = makeStaging(releaseDir)
const staged = [
  stageSidecar(stagingDir, 'checksums.json', `${JSON.stringify(checksums, null, 2)}\n`),
  stageSidecar(stagingDir, 'SHA256SUMS.txt', `${table}\n`),
  stageSidecar(stagingDir, 'ACCEPTANCE.md', acceptance)
]
// Promote the staged release report in the SAME transaction (no direct overwrite).
if (stagedReportJson) staged.push(stageSidecar(stagingDir, 'release-report.json', stagedReportJson))
// The update manifest is the FOURTH official sidecar: it is promoted, or not
// promoted, atomically WITH checksums/SHA256SUMS/ACCEPTANCE. A manifest that
// survived a failed gate would describe a build we refused to bless — and it is
// the one file a user's app would trust blindly.
if (updateManifest.json) staged.push(stageSidecar(stagingDir, UPDATE_MANIFEST_FILE, updateManifest.json))
const candidates = installers.map(i => fingerprintCandidate(path.join(releaseDir, i.name)))
const result = finalizeSidecars({ stagingDir, targetDir: releaseDir, staged, candidates, gatePassed })

if (!result.promoted) {
  console.error(`Refusing to promote official sidecars (reason: ${result.reason}). Prior sidecars left untouched. ` +
    (blocking.length ? `\nBlocking failures:\n - ${blocking.map(f => `[${f.code}] ${f.detail}`).join('\n - ')}` : ''))
  process.exit(1)
}
console.log(`Promoted ${result.files.join(', ')} atomically (channel=${channel}, binding ${String(binding.digest).slice(0, 16)}…).`)
