import { describe, expect, it } from 'vitest'
import { proveContainmentBound, containmentDigest } from './nsis-payload.mjs'
import { decideContainment } from './containment.mjs'

const MANIFEST = JSON.stringify({ schema: 1, version: '0.3.3', app_asar: { sha256: 'ASAR' } })
const ATTEST = JSON.stringify({ schema: 1, build_nonce: 'NONCE', source_fingerprint: 'FP' })
const EXPECTED = { manifestJson: MANIFEST, attestationJson: ATTEST, appAsarSha256: 'a'.repeat(64) }

// A fake installer whose payload holds exactly the expected bytes.
function goodExtract(_i, inner) {
  if (inner.endsWith('release-manifest.json')) return MANIFEST
  if (inner.endsWith('build-attestation.json')) return ATTEST
  return null
}
const goodBinary = () => Buffer.alloc(0) // sha256 of empty buffer, we pin appAsarSha256 to that

const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

describe('proveContainmentBound — multi-fact extraction (CRITICAL 1)', () => {
  const expected = { ...EXPECTED, appAsarSha256: EMPTY_SHA }

  it('with NO extractor it does not fake — proven false, digest null', () => {
    const r = proveContainmentBound({ installerPath: 'x.exe', expected, tool: null })
    expect(r.proven).toBe(false)
    expect(r.reason).toBe('no-nsis-extractor')
    expect(r.digest).toBeNull()
  })

  it('PROVES when manifest+attestation+app.asar all match, binding a digest', () => {
    const r = proveContainmentBound({ installerPath: 'x.exe', expected, tool: '7z', extractEntry: goodExtract, extractBinary: goodBinary })
    expect(r.proven).toBe(true)
    expect(r.extracted.app_asar_sha256).toBe(EMPTY_SHA)
    expect(r.digest).toBe(containmentDigest(r.extracted))
  })

  it('REFUSES when the embedded manifest is swapped (adversarial)', () => {
    const r = proveContainmentBound({ installerPath: 'x.exe', expected, tool: '7z', extractBinary: goodBinary,
      extractEntry: (_i, inner) => inner.includes('manifest') ? JSON.stringify({ evil: true }) : ATTEST })
    expect(r.proven).toBe(false)
    expect(r.mismatches).toContain('manifest')
  })

  it('REFUSES when the embedded attestation (nonce) is swapped', () => {
    const r = proveContainmentBound({ installerPath: 'x.exe', expected, tool: '7z', extractBinary: goodBinary,
      extractEntry: (_i, inner) => inner.includes('attestation') ? JSON.stringify({ build_nonce: 'FORGED' }) : MANIFEST })
    expect(r.proven).toBe(false)
    expect(r.mismatches).toContain('attestation')
  })

  it('REFUSES when the payload app.asar hash disagrees with the manifest claim', () => {
    const r = proveContainmentBound({ installerPath: 'x.exe', expected, tool: '7z', extractEntry: goodExtract,
      extractBinary: () => Buffer.from('DIFFERENT-BYTES') })
    expect(r.proven).toBe(false)
    expect(r.mismatches).toContain('app.asar')
  })

  it('REFUSES when the attestation is absent from the payload', () => {
    const r = proveContainmentBound({ installerPath: 'x.exe', expected, tool: '7z', extractBinary: goodBinary,
      extractEntry: (_i, inner) => inner.includes('attestation') ? null : MANIFEST })
    expect(r.proven).toBe(false)
    expect(r.reason).toBe('attestation-not-in-payload')
  })

  it('a throwing extractor is honest not-proven, never a crash', () => {
    const r = proveContainmentBound({ installerPath: 'x.exe', expected, tool: '7z', extractEntry: () => { throw new Error('bad archive') } })
    expect(r.proven).toBe(false)
    expect(r.reason).toMatch(/extract-failed/)
  })
})

describe('decideContainment — report boolean is never trusted (CRITICAL 1)', () => {
  const good = proveContainmentBound({ installerPath: 'x.exe', expected: { ...EXPECTED, appAsarSha256: EMPTY_SHA }, tool: '7z', extractEntry: goodExtract, extractBinary: goodBinary })
  const honestReport = { payload_binding: { proven: true, containment_digest: good.digest } }

  it('passes when independent re-extraction proves AND the digest matches the report', () => {
    const v = decideContainment({ report: honestReport, independent: good, channel: 'public' })
    expect(v.ok).toBe(true)
  })

  it('ADVERSARIAL: report flips proven=true but no real extraction → fail closed', () => {
    const noExtractor = proveContainmentBound({ installerPath: 'x.exe', expected: EXPECTED, tool: null })
    const v = decideContainment({ report: { payload_binding: { proven: true, containment_digest: 'deadbeef' } }, independent: noExtractor, channel: 'public' })
    expect(v.ok).toBe(false)
    expect(v.code).toBe('containment-not-independently-proven')
  })

  it('ADVERSARIAL: report digest disagrees with the bytes actually inside → forgery caught', () => {
    const v = decideContainment({ report: { payload_binding: { proven: true, containment_digest: 'f'.repeat(64) } }, independent: good, channel: 'public' })
    expect(v.ok).toBe(false)
    expect(v.code).toBe('containment-digest-mismatch')
  })

  it('ADVERSARIAL: report proven but omits the containment_digest → cannot bind', () => {
    const v = decideContainment({ report: { payload_binding: { proven: true } }, independent: good, channel: 'public' })
    expect(v.ok).toBe(false)
    expect(v.code).toBe('containment-digest-absent')
  })

  it('a report that honestly concedes unproven is not promotable', () => {
    const v = decideContainment({ report: { payload_binding: { proven: false, reason: 'no-nsis-extractor' } }, independent: good, channel: 'public' })
    expect(v.ok).toBe(false)
    expect(v.code).toBe('containment-report-unproven')
  })

  it('public requires the app.asar to have been extracted & hashed', () => {
    const noApp = proveContainmentBound({ installerPath: 'x.exe', expected: { manifestJson: MANIFEST, attestationJson: ATTEST }, tool: '7z', extractEntry: goodExtract, extractBinary: goodBinary })
    const rep = { payload_binding: { proven: true, containment_digest: noApp.digest } }
    const v = decideContainment({ report: rep, independent: noApp, channel: 'public' })
    expect(v.ok).toBe(false)
    expect(v.code).toBe('containment-app-not-covered')
  })

  it('pilot is full-rigor: passes exactly like public when containment is proven', () => {
    const v = decideContainment({ report: honestReport, independent: good, channel: 'pilot' })
    expect(v.ok).toBe(true)
  })

  it('pilot ALSO requires the app.asar to have been extracted & hashed (full rigor, no exemption)', () => {
    const noApp = proveContainmentBound({ installerPath: 'x.exe', expected: { manifestJson: MANIFEST, attestationJson: ATTEST }, tool: '7z', extractEntry: goodExtract, extractBinary: goodBinary })
    const rep = { payload_binding: { proven: true, containment_digest: noApp.digest } }
    const v = decideContainment({ report: rep, independent: noApp, channel: 'pilot' })
    expect(v.ok).toBe(false)
    expect(v.code).toBe('containment-app-not-covered')
  })

  it('no report at all fails closed', () => {
    expect(decideContainment({ report: null, independent: good }).code).toBe('containment-no-report')
  })
})
