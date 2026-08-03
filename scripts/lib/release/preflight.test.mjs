import { describe, expect, it } from 'vitest'
import { preflightRelease } from './preflight.mjs'
import { buildReleaseManifest, buildReleaseReport } from './manifest.mjs'
import { containmentDigest } from './nsis-payload.mjs'

// A fully contract-clean, signed public release, assembled synthetically (no
// dependency on the real, stale artifact). Each case mutates ONE facet.
const FP = 'f'.repeat(64)
const HEAD = 'a'.repeat(40)
const SHA = 'd'.repeat(64)
const NONCE = 'n'.repeat(32)
const PROD = 'App'
const NAME = 'Tachles-Setup-0.3.3.exe'
const APPROVED = { subjects: ['Contoso, Inc.'], thumbprints: [] }
const sig = { valid: true, trustedTimestamp: true, status: 'Valid', publisher: 'Contoso, Inc.', thumbprint: null }
const attestation = { artifact_kind: 'win-unpacked-current', app_version: '0.3.3', source_head: HEAD, source_fingerprint: FP, build_nonce: NONCE }
const appAsar = { bytes: 4096, sha256: 'c'.repeat(64) }
const installers = [{ name: NAME, version: '0.3.3', bytes: 100, sha256: SHA }]
const evDigests = { 'packaged-e2e': 'p', approval: 'ap', 'shared-state': 'ss', 'thin-installer': 'ti', telegram: 'tg' }

const manifest = buildReleaseManifest({ version: '0.3.3', commit: HEAD, subject: 'feat: x', attestation, appAsar, evidenceDigests: evDigests })
// CRITICAL 1: a proven build carries a containment digest the verifier independently
// recomputes. Report + independent extraction agree on the same extracted facts.
const extracted = { manifest_sha256: 'm'.repeat(64), attestation_sha256: 'a'.repeat(64), app_asar_sha256: appAsar.sha256 }
const cdigest = containmentDigest(extracted)
const provenContainment = { proven: true, method: '7z', reason: '', digest: cdigest, extracted }
const report = buildReleaseReport({ manifest, installers, payloadBinding: provenContainment })
const build = { build_nonce: NONCE, release_binding_digest: report.release_binding_digest, installer_sha256: SHA }

function goodState(over = {}) {
  return {
    channel: 'public', productName: PROD, packageVersion: '0.3.3', currentHead: HEAD, currentFingerprint: FP, headSubject: 'feat: x', attestationProvenance: { relation: 'equal', changed: [] },
    dirtyInputs: [], attestation, installers,
    checksums: { installers: [{ name: NAME, bytes: 100, sha256: SHA }] },
    asar: { present: true, valid: true, forbidden: [], unsafe: [] },
    signatures: { installer: sig, app: sig }, signAllowlist: APPROVED,
    ledger: { source: 'signed-ledger', entries: { '0.3.3': { sha256: SHA } } },
    lockAttest: { scheme: 1, package_lock_sha256: 'l'.repeat(64), node_version: 'v22.10.0', npm_version: '10.9.0', ci_clean: true },
    currentLockSha256: 'l'.repeat(64),
    releaseReport: report, independentContainment: provenContainment, observed: { version: '0.3.3', installers, appAsar, attestation, evidenceDigests: evDigests, embeddedManifest: manifest },
    build,
    evidence: { ok: true, counts: { 'packaged-e2e': 1, approval: 1, 'shared-state': 1, 'thin-installer': 1, telegram: 1 }, statuses: { 'packaged-e2e': 'passed', approval: 'passed', 'shared-state': 'passed', 'thin-installer': 'passed', telegram: 'passed' }, packagedBinding: { ...build, capture_method: 'machine' } },
    ...over
  }
}
const codes = v => v.failures.map(f => f.code)

describe('preflightRelease — hardened happy path', () => {
  it('a signed, fresh, fully-bound public build is ok AND distributable', () => {
    const v = preflightRelease(goodState())
    expect(v.failures).toEqual([])
    expect(v.distributable).toBe(true)
  })
})

describe('preflightRelease — each honest failure', () => {
  it('corrupt/missing asar blocks (finding 2)', () => {
    expect(codes(preflightRelease(goodState({ asar: { present: false, valid: false, error: 'asar header truncated' } })))).toContain('asar-invalid')
  })
  it('asar traversal path blocks (finding 10)', () => {
    expect(codes(preflightRelease(goodState({ asar: { present: true, valid: true, forbidden: [], unsafe: [{ path: '../x', reason: 'illegal segment' }] } })))).toContain('asar-unsafe-path')
  })
  it('wrong/extra artifact name blocks (finding 9)', () => {
    expect(codes(preflightRelease(goodState({ installers: [{ name: 'random.exe', version: null, bytes: 1, sha256: SHA }] })))).toContain('artifact-set')
  })
  it('no durable ledger fails public closed (finding 5)', () => {
    expect(codes(preflightRelease(goodState({ ledger: null })))).toContain('version-ledger-unavailable')
  })
  it('same version, different bytes is a reuse collision (finding 5)', () => {
    expect(codes(preflightRelease(goodState({ ledger: { source: 'signed-ledger', entries: { '0.3.3': { sha256: '0'.repeat(64) } } } })))).toContain('version-reuse')
  })
  it('public requires telegram + thin-installer passed (finding 6)', () => {
    const v = preflightRelease(goodState({ evidence: { ...goodState().evidence, statuses: { 'packaged-e2e': 'passed', approval: 'passed', 'shared-state': 'passed', 'thin-installer': 'blocked', telegram: 'blocked' } } }))
    expect(codes(v)).toContain('evidence-not-passed')
  })
  it('a duplicate evidence category blocks (finding 6)', () => {
    expect(codes(preflightRelease(goodState({ evidence: { ...goodState().evidence, counts: { ...goodState().evidence.counts, approval: 2 } } })))).toContain('evidence-category-duplicate')
  })
  it('packaged-e2e evidence from a different build blocks (finding 4)', () => {
    expect(codes(preflightRelease(goodState({ evidence: { ...goodState().evidence, packagedBinding: { ...build, build_nonce: 'OTHER' } } })))).toContain('evidence-wrong-build')
  })
  it('a tampered release report blocks (finding 3)', () => {
    const bad = JSON.parse(JSON.stringify(report)); bad.manifest.version = '9.9.9'
    expect(codes(preflightRelease(goodState({ releaseReport: bad })))).toContain('release-report')
  })
  it('missing release report blocks public (finding 1)', () => {
    expect(codes(preflightRelease(goodState({ releaseReport: null })))).toContain('release-report')
  })
  it('unproven payload binding blocks public — independent re-extraction (CRITICAL 1)', () => {
    const rep = buildReleaseReport({ manifest, installers, payloadBinding: { proven: false, method: 'none', reason: 'no-nsis-extractor' } })
    const noExtract = { proven: false, method: 'none', reason: 'no-nsis-extractor', digest: null, extracted: null }
    expect(codes(preflightRelease(goodState({ releaseReport: rep, independentContainment: noExtract, observed: { ...goodState().observed, embeddedManifest: rep.manifest } })))).toContain('containment-not-independently-proven')
  })
  it('ADVERSARIAL: toggled proven=true with no real extraction still blocks (CRITICAL 1)', () => {
    // Report LIES: proven=true with a plausible digest, but the verifier's own
    // extraction never ran (off-box). The report boolean is not trusted.
    const rep = buildReleaseReport({ manifest, installers, payloadBinding: { proven: true, digest: cdigest, extracted } })
    const noExtract = { proven: false, method: 'none', reason: 'no-nsis-extractor', digest: null, extracted: null }
    expect(codes(preflightRelease(goodState({ releaseReport: rep, independentContainment: noExtract })))).toContain('containment-not-independently-proven')
  })
  it('ADVERSARIAL: report digest describing bytes not in this installer blocks (CRITICAL 1)', () => {
    const forged = { proven: true, method: '7z', reason: '', digest: 'f'.repeat(64), extracted: { ...extracted, app_asar_sha256: 'x'.repeat(64) } }
    expect(codes(preflightRelease(goodState({ independentContainment: forged })))).toContain('containment-digest-mismatch')
  })
  it('missing lockfile-integrity attestation blocks public (finding 7)', () => {
    expect(codes(preflightRelease(goodState({ lockAttest: null })))).toContain('lock-integrity-unattested')
  })
  it('ADVERSARIAL: lock attestation whose hash != lockfile on disk blocks (HIGH 5)', () => {
    expect(codes(preflightRelease(goodState({ currentLockSha256: 'z'.repeat(64) })))).toContain('lock-attest-mismatch')
  })
  it('ADVERSARIAL: an UNAUTHENTICATED ledger on disk is not trusted (HIGH 6)', () => {
    const v = preflightRelease(goodState({ rawLedger: { source: 'signed-ledger', entries: {} }, ledger: null, ledgerAuth: { authenticated: false, reason: 'no-signature' } }))
    expect(codes(v)).toContain('ledger-unauthenticated')
    expect(codes(v)).toContain('version-ledger-unavailable')
  })
  it('ADVERSARIAL: evidence nonce from a different build splits the identity chain (HIGH 7)', () => {
    const badEv = { ...goodState().evidence, packagedBinding: { build_nonce: 'OTHER', release_binding_digest: report.release_binding_digest } }
    expect(codes(preflightRelease(goodState({ evidence: badEv })))).toContain('identity-nonce-split')
  })
  it('dirty lockfile input blocks (finding 7)', () => {
    expect(codes(preflightRelease(goodState({ dirtyInputs: ['package-lock.json'] })))).toContain('dirty-inputs')
  })
  it('allows an evidence-only commit after the attested source commit', () => {
    const v = preflightRelease(goodState({ currentHead: 'b'.repeat(40), attestationProvenance: { relation: 'evidence-descendant', changed: ['docs/evidence/approval.json'] } }))
    expect(codes(v)).not.toContain('attestation-head-stale')
  })
  it('blocks a code commit after the attested source commit', () => {
    const v = preflightRelease(goodState({ currentHead: 'b'.repeat(40), attestationProvenance: { relation: 'code-descendant', changed: ['src/main.ts'] } }))
    expect(codes(v)).toContain('attestation-head-stale')
  })
  it('wrong signer blocks public (finding 8)', () => {
    const wrong = { ...sig, publisher: 'Evil Corp', thumbprint: null }
    expect(codes(preflightRelease(goodState({ signatures: { installer: wrong, app: wrong } })))).toContain('publisher-not-approved')
  })
})

describe('preflightRelease — QA channel is lenient but non-distributable', () => {
  it('QA tolerates no-ledger, unsigned, external blockers, no report/lock', () => {
    const v = preflightRelease(goodState({ channel: 'qa', ledger: null, lockAttest: null, releaseReport: null, signatures: { installer: null, app: null }, signAllowlist: { subjects: [], thumbprints: [] }, evidence: { ok: true, counts: { 'packaged-e2e': 1, approval: 1, 'shared-state': 1, 'thin-installer': 1, telegram: 1 }, statuses: { 'packaged-e2e': 'passed', approval: 'passed', 'shared-state': 'passed', 'thin-installer': 'blocked', telegram: 'blocked' }, packagedBinding: { ...build, capture_method: 'machine' } } }))
    expect(v.ok).toBe(true)
    expect(v.distributable).toBe(false)
    expect(v.externalBlockers).toEqual(['thin-installer', 'telegram'])
  })
})
