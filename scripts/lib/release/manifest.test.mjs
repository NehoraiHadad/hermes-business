import { describe, expect, it } from 'vitest'
import {
  buildReleaseManifest, buildReleaseReport, manifestDigest, verifyReleaseReport
} from './manifest.mjs'

const FP = 'f'.repeat(64)
const attestation = { app_version: '0.3.3', source_head: 'a'.repeat(40), source_fingerprint: FP, artifact_kind: 'win-unpacked-current', build_nonce: 'n'.repeat(32) }
const appAsar = { bytes: 4096, sha256: 'c'.repeat(64) }
const installers = [{ name: 'Setup 0.3.3.exe', bytes: 100, sha256: 'd'.repeat(64) }]

function makeReport(over = {}) {
  const manifest = buildReleaseManifest({
    version: '0.3.3', commit: 'a'.repeat(40), subject: 'feat: x',
    attestation, appAsar, evidenceDigests: { 'packaged-e2e': 'e1', approval: 'e2' }, ...over
  })
  return buildReleaseReport({ manifest, installers, payloadBinding: { proven: true, method: 'nsis-extract', reason: '' } })
}
const observed = { version: '0.3.3', installers, appAsar, attestation, evidenceDigests: { 'packaged-e2e': 'e1', approval: 'e2' } }

describe('release report — happy path (findings 1,3,4)', () => {
  it('a report cut against the observed facts verifies', () => {
    const r = verifyReleaseReport(makeReport(), { ...observed, embeddedManifest: makeReport().manifest })
    expect(r.ok).toBe(true)
  })
  it('carries a build_nonce and non-circular digests', () => {
    const rep = makeReport()
    expect(rep.manifest.build_nonce).toBe('n'.repeat(32))
    expect(rep.manifest).not.toHaveProperty('manifest_digest')
    expect(manifestDigest(rep.manifest)).toBe(rep.manifest_digest)
  })
})

describe('release report — adversarial tamper (finding 3)', () => {
  it('editing the manifest body without recomputing the digest is caught', () => {
    const rep = makeReport()
    rep.manifest.version = '9.9.9' // tamper, leave manifest_digest stale
    const r = verifyReleaseReport(rep, observed)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/report tampered/)
  })
  it('swapping installer bytes in the report breaks release_binding_digest', () => {
    const rep = makeReport()
    rep.installers[0].sha256 = '0'.repeat(64)
    const r = verifyReleaseReport(rep, observed)
    expect(r.errors.join(' ')).toMatch(/release_binding_digest|tampered/)
  })
  it('a missing build_nonce fails closed', () => {
    const r = verifyReleaseReport(makeReport({ attestation: { ...attestation, build_nonce: null } }), observed)
    expect(r.errors.join(' ')).toMatch(/build_nonce/)
  })
})

describe('release report — disk drift (findings 1,4,12)', () => {
  it('an EMBEDDED manifest that differs from the report is loose-win-unpacked (finding 1)', () => {
    const rep = makeReport()
    const other = makeReport({ subject: 'feat: different' }).manifest
    const r = verifyReleaseReport(rep, { ...observed, embeddedManifest: other })
    expect(r.errors.join(' ')).toMatch(/embedded .* differs|loose win-unpacked/)
  })
  it('an app.asar hash drift on disk is caught (finding 2/12)', () => {
    const r = verifyReleaseReport(makeReport(), { ...observed, appAsar: { bytes: 4096, sha256: '1'.repeat(64) } })
    expect(r.errors.join(' ')).toMatch(/app\.asar/)
  })
  it('an installer mutated mid-run (bytes changed on disk) is caught (finding 12)', () => {
    const r = verifyReleaseReport(makeReport(), { ...observed, installers: [{ name: 'Setup 0.3.3.exe', bytes: 200, sha256: 'd'.repeat(64) }] })
    expect(r.errors.join(' ')).toMatch(/artifact mutated mid-run/)
  })
  it('an evidence digest cut against a DIFFERENT build is caught (finding 4)', () => {
    const r = verifyReleaseReport(makeReport(), { ...observed, evidenceDigests: { 'packaged-e2e': 'WRONG', approval: 'e2' } })
    expect(r.errors.join(' ')).toMatch(/evidence digest .* drifted/)
  })
})
