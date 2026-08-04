import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  ARTIFACT_KIND,
  ATTESTATION_BASENAME,
  ATTESTATION_SCHEMA,
  attestationPathInUnpacked,
  buildAttestation,
  computeSourceFingerprint,
  detectBuildMode,
  repoRoot,
  resolvePackagedArtifact,
  verifyArtifactCurrent,
  writeAttestation
} from './build-attestation.mjs'
import { fakeRoot, cleanupRoots } from './attest-fixtures.mjs'

// The fake repo root (attest-fixtures.mjs) carries the COMPLETE packaged-source
// input set, so the fingerprint/version checks here operate on a controlled
// surface without touching the real working tree. The fingerprint-SCOPE tests
// (what drift does/doesn't invalidate) live in source-fingerprint.test.mjs.

afterEach(cleanupRoots)

describe('buildAttestation', () => {
  it('records the current-source kind, version and a fresh nonce', () => {
    const { root } = fakeRoot({ version: '1.2.3' })
    const m = buildAttestation(root)
    expect(m.artifact_kind).toBe(ARTIFACT_KIND)
    expect(m.app_version).toBe('1.2.3')
    expect(m.build_nonce).toMatch(/^[0-9a-f]{32}$/)
    expect(m.source_fingerprint).toBe(computeSourceFingerprint(root).fingerprint)
  })

  it('records build_mode independently — "unknown" when dist/ was never built (fixture has no dist/)', () => {
    const { root } = fakeRoot()
    const m = buildAttestation(root)
    expect(m.schema).toBe(ATTESTATION_SCHEMA)
    expect(m.build_mode).toBe('unknown')
    expect(m.demo_stub_detected).toBe(false)
  })
})

describe('detectBuildMode — independent on-disk proof of production vs qa (pilot gate, docs/specs/versioning.md §13 stage 5)', () => {
  it('absent dist/ → unknown (never guesses production)', () => {
    const { root } = fakeRoot()
    expect(detectBuildMode(root)).toMatchObject({ build_mode: 'unknown', demo_stub_detected: false, reason: 'dist-missing' })
  })

  it('dist/ carrying the demo-strip stub text → production (fixtures physically stripped)', () => {
    const { root, put } = fakeRoot()
    put('dist/assets/index-abc123.js', `console.log("x");function f(){throw new Error('demo fixtures are not shipped in this build')}`)
    expect(detectBuildMode(root)).toMatchObject({ build_mode: 'production', demo_stub_detected: true })
  })

  it('dist/ with real bundle code but NO stub text → qa (demo module compiled in)', () => {
    const { root, put } = fakeRoot()
    put('dist/assets/index-abc123.js', `console.log("x");export function createDemoBackend(){return {}}`)
    expect(detectBuildMode(root)).toMatchObject({ build_mode: 'qa', demo_stub_detected: false })
  })

  it('scans nested asset directories, not just the top level', () => {
    const { root, put } = fakeRoot()
    put('dist/assets/chunks/vendor-xyz.mjs', `throw new Error('demo fixtures are not shipped in this build')`)
    expect(detectBuildMode(root).build_mode).toBe('production')
  })
})

describe('verifyArtifactCurrent — fail BEFORE launch', () => {
  function prepare(opts) {
    const { root, unpacked } = fakeRoot(opts)
    writeAttestation(attestationPathInUnpacked(unpacked), root)
    return { root, unpacked }
  }

  it('accepts an artifact attested to the current source', () => {
    const { root, unpacked } = prepare()
    const v = verifyArtifactCurrent({ dir: unpacked, root })
    expect(v.ok).toBe(true)
    expect(v.attested).toBe(true)
    expect(v.kind).toBe(ARTIFACT_KIND)
    expect(v.currentFingerprintPrefix).toMatch(/^[0-9a-f]{16}$/)
  })

  it('REJECTS a stale build whose source drifted from the artifact', () => {
    const { root, unpacked } = prepare()
    // Simulate a stale installed/build binary: the source moved on after the
    // artifact was attested. This is the incident class — must be caught.
    writeFileSync(path.join(root, 'electron', 'b.cjs'), 'module.exports=99\n')
    const v = verifyArtifactCurrent({ dir: unpacked, root })
    expect(v.ok).toBe(false)
    expect(v.reasons).toContain('source-fingerprint-mismatch')
  })

  it('rejects a version-mismatched artifact', () => {
    const { root, unpacked } = prepare({ version: '1.0.0' })
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ version: '1.0.1', main: 'electron/main.cjs', build: { productName: 'Widget' } })
    )
    const v = verifyArtifactCurrent({ dir: unpacked, root })
    expect(v.ok).toBe(false)
    expect(v.reasons).toContain('app-version-mismatch')
  })

  it('rejects an artifact with no embedded manifest', () => {
    const { root, unpacked } = fakeRoot()
    const v = verifyArtifactCurrent({ dir: unpacked, root })
    expect(v.ok).toBe(false)
    expect(v.reasons).toContain('attestation-manifest-missing')
  })
})

describe('resolvePackagedArtifact — win-unpacked only, no installed fallback', () => {
  it('resolves the product exe inside release/win-unpacked', () => {
    const { root, unpacked } = fakeRoot({ productName: 'Widget' })
    const r = resolvePackagedArtifact({ root })
    expect(r.unpackedDir).toBe(unpacked)
    expect(r.executablePath).toBe(path.join(unpacked, 'Widget.exe'))
    // Never an installed-programs path.
    expect(r.executablePath.toLowerCase()).not.toContain('programs')
  })

  it('throws (does not fall back) when win-unpacked is absent', () => {
    const { root } = fakeRoot()
    rmSync(path.join(root, 'release'), { recursive: true, force: true })
    expect(() => resolvePackagedArtifact({ root })).toThrow(/win-unpacked not found/)
  })
})

describe('hygiene: the generated attestation is never committable', () => {
  // build/build-attestation.json is a per-build nonce/fingerprint written by
  // gen-build-attestation.mjs and copied into the artifact via extraResources; it
  // must stay untracked. Assert .gitignore names the exact generated path.
  it('.gitignore ignores build/<attestation basename>', () => {
    const ignore = readFileSync(path.join(repoRoot(), '.gitignore'), 'utf8')
    const rel = `build/${ATTESTATION_BASENAME}`
    const lines = ignore.split(/\r?\n/).map(l => l.trim())
    expect(lines).toContain(rel)
  })
})
