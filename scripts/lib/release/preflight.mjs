// The fail-closed release preflight — ONE pure verdict over already-gathered
// facts. No I/O: gather.mjs collects the workspace state, this function decides.
// Every rule is unit-testable with synthetic fixtures and free of the current
// (stale) release artifact. A failure is a { code, detail } pair; `ok` is true only
// when NO failure fired; `distributable` additionally requires the signing gate.

import { evaluateSigning, signerApproved } from './signing.mjs'
import { evaluatePayloadSigning } from './pe-inventory.mjs'
import { verifyChecksums } from './checksums.mjs'
import { verifyArtifactSet } from './artifact-set.mjs'
import { checkVersionImmutability } from './prior-ledger.mjs'
import { verifyReleaseReport } from './manifest.mjs'
import { checkCardinality, checkGateStatuses, checkPackagedBinding } from './evidence-binding.mjs'
import { decideContainment } from './containment.mjs'
import { verifyLockAttestation } from './lock-attest.mjs'
import { verifyIdentityChain } from './identity-chain.mjs'

export function preflightRelease(state) {
  const F = []
  const add = (code, detail) => F.push({ code, detail })
  const channel = state.channel

  // 1. No dirty runtime/build/config inputs (registry-derived; see porcelain.mjs).
  if (state.dirtyInputs && state.dirtyInputs.length) {
    add('dirty-inputs', `${state.dirtyInputs.length} input(s) uncommitted: ${state.dirtyInputs.slice(0, 6).join(', ')}${state.dirtyInputs.length > 6 ? ' …' : ''}`)
  }

  // 2. Build attestation present, well-formed, not stale vs the current tree.
  const at = state.attestation
  if (!at) add('attestation-missing', 'resources/build-attestation.json absent')
  else {
    if (at.artifact_kind !== 'win-unpacked-current') add('attestation-kind', `artifact_kind ${JSON.stringify(at.artifact_kind)}`)
    if (at.app_version !== state.packageVersion) add('attestation-version', `attested ${at.app_version} != package.json ${state.packageVersion}`)
    if (at.source_fingerprint !== state.currentFingerprint) add('attestation-fingerprint-stale', `attested fingerprint ${short(at.source_fingerprint)} != current ${short(state.currentFingerprint)}`)
    if (at.source_head && state.currentHead && at.source_head !== state.currentHead) add('attestation-head-stale', `attested head ${short(at.source_head)} != HEAD ${short(state.currentHead)}`)
  }

  // 3. EXACT expected artifact set + versioned names (finding 9).
  const installers = state.installers || []
  for (const e of verifyArtifactSet({ productName: state.productName, version: state.packageVersion, installers }).errors) add('artifact-set', e)

  // 4. Checksum manifest describes the bytes on disk.
  const ck = verifyChecksums(state.checksums, installers.map(b => ({ name: b.name, bytes: b.bytes, sha256: b.sha256 })))
  if (!ck.ok) for (const e of ck.errors) add('checksums-invalid', e)

  // 5. app.asar present, valid, no forbidden or traversal paths (findings 2,10).
  const asar = state.asar
  if (!asar || !asar.valid) add('asar-invalid', `app.asar missing/corrupt/incomplete${asar?.error ? `: ${asar.error}` : ''}`)
  else {
    if (asar.forbidden.length) add('packaged-forbidden', `app.asar ships ${asar.forbidden.length} forbidden entr(y/ies): ${asar.forbidden.slice(0, 5).join(', ')}`)
    if (asar.unsafe && asar.unsafe.length) add('asar-unsafe-path', `app.asar has ${asar.unsafe.length} unsafe path(s): ${asar.unsafe.slice(0, 3).map(u => `${u.path} (${u.reason})`).join(', ')}`)
  }

  // 6. Version immutability against an AUTHENTICATED durable prior-release ledger
  //    (findings 5 + HIGH 6). gather.mjs already authenticated the ledger's
  //    provenance (signed body verified against a committed trust-root key, or a
  //    committed GitHub asset digest); state.ledger is null unless authentic. An
  //    unauthenticated ledger present on disk is surfaced explicitly and treated as
  //    absent, so a forged label can never grant immutability.
  if (channel === 'public' && state.rawLedger && state.ledgerAuth && state.ledgerAuth.authenticated !== true) {
    add('ledger-unauthenticated', `release-ledger.json is not authenticated (${state.ledgerAuth.reason}); a self-applied "source" label is never trusted`)
  }
  const imm = checkVersionImmutability({ channel, version: state.packageVersion, installerSha256: installers[0]?.sha256, ledger: state.ledger })
  if (!imm.ok) add(imm.code, imm.detail)

  // 7. Evidence: verified, exactly-one-per-category, channel gates, build binding.
  if (!state.evidence || state.evidence.ok !== true) add('evidence-unverified', 'verify-evidence did not pass')
  for (const e of checkCardinality(state.evidence?.counts || {})) add(e.code, e.detail)
  const gates = checkGateStatuses(channel, state.evidence?.statuses || {})
  for (const f of gates.failures) add(f.code, f.detail)
  if (state.evidence?.statuses?.['packaged-e2e'] === 'passed') {
    for (const f of checkPackagedBinding(state.evidence.packagedBinding, state.build)) add(f.code, f.detail)
  }

  // 8. Release report: tamper-evident + INDEPENDENTLY re-proven installer↔payload
  //    containment (CRITICAL 1). The report's own `proven` boolean is never trusted:
  //    decideContainment compares the digest the verifier recomputed from the bytes
  //    actually extracted out of the installer (state.independentContainment) with
  //    the digest the report recorded, and requires the verifier's own extraction
  //    to have succeeded. A toggled boolean or a report digest describing bytes not
  //    in this installer fails closed.
  if (state.releaseReport) {
    for (const e of verifyReleaseReport(state.releaseReport, state.observed || {}).errors) add('release-report', e)
  } else if (channel === 'public') {
    add('release-report', 'release/release-report.json missing; installer not bound to packaged manifest')
  }
  const containment = decideContainment({ report: state.releaseReport, independent: state.independentContainment, channel })
  if (channel === 'public' && !containment.ok) {
    add(containment.code || 'payload-binding-unproven', `installer↔payload containment not independently proven: ${containment.detail}`)
  }

  // 8b. HIGH 7 — ONE build identity chain. When a report + attestation are present,
  //     the per-build nonce and source identity must be consistent across the
  //     attestation, the embedded manifest, the packaged-e2e evidence and the
  //     current build. A spliced/mixed A-vs-B build fails closed.
  if (state.releaseReport?.manifest && state.attestation) {
    for (const f of verifyIdentityChain({ attestation: state.attestation, manifest: state.releaseReport.manifest, evidenceBinding: state.evidence?.packagedBinding, build: state.build }).failures) add(f.code, f.detail)
  }

  // 9. Clean-install / lockfile integrity attestation (finding 7 + HIGH 5): the
  //    attestation's recorded package-lock SHA256 must equal the lockfile on disk
  //    now and record the npm-ci toolchain provenance — a self-asserted boolean is
  //    insufficient.
  for (const f of verifyLockAttestation({ attestation: state.lockAttest, currentLockSha256: state.currentLockSha256, channel }).failures) add(f.code, f.detail)

  // 10. Signing gate — approved publisher + trusted timestamp for public (finding 8).
  const sig = evaluateSigning({ channel, installer: state.signatures?.installer, app: state.signatures?.app, allowlist: state.signAllowlist })
  for (const f of sig.failures) add(f.code, f.detail)

  // 10b. CRITICAL 2 — the public claim covers EVERY shipped executable, not just
  //      the installer + product exe: elevate.exe, runtime DLLs and native addons
  //      must each carry an approved, timestamped signature (or a justified
  //      exclusion). An unsigned helper under a signed installer fails public closed.
  const peSig = evaluatePayloadSigning({
    channel,
    pes: state.payloadSigning?.pes || [],
    allowlist: state.signAllowlist,
    exclusions: state.payloadSigning?.exclusions || [],
    unjustified: state.payloadSigning?.unjustified || [],
    signerApproved
  })
  for (const f of peSig.failures) add(f.code, f.detail)

  const ok = F.length === 0
  return { ok, channel, distributable: ok && sig.distributable, label: sig.label, failures: F, externalBlockers: gates.externalBlockers, signing: sig, immutability: imm }
}

function short(h) {
  return typeof h === 'string' && h.length > 12 ? h.slice(0, 12) : String(h)
}
