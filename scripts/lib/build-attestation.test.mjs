import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ARTIFACT_KIND,
  ATTESTATION_BASENAME,
  attestationPathInUnpacked,
  buildAttestation,
  computeSourceFingerprint,
  repoRoot,
  resolvePackagedArtifact,
  verifyArtifactCurrent,
  writeAttestation
} from './build-attestation.mjs'

// A self-consistent fake repo root: package.json + release/win-unpacked + an
// electron/ tree, so the fingerprint/version checks operate on a controlled
// surface without touching the real working tree.

const created = []
function fakeRoot({ version = '9.9.9', productName = 'Widget', electron = { 'a.cjs': 'module.exports=1\n' } } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'attest-root-'))
  created.push(root)
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ version, main: 'electron/main.cjs', build: { productName } }, null, 2)
  )
  const elDir = path.join(root, 'electron')
  mkdirSync(elDir, { recursive: true })
  for (const [name, body] of Object.entries(electron)) writeFileSync(path.join(elDir, name), body)
  const unpacked = path.join(root, 'release', 'win-unpacked')
  mkdirSync(path.join(unpacked, 'resources'), { recursive: true })
  writeFileSync(path.join(unpacked, `${productName}.exe`), 'MZ-fake')
  return { root, unpacked }
}

afterEach(() => {
  while (created.length) {
    try {
      rmSync(created.pop(), { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

describe('computeSourceFingerprint', () => {
  it('is deterministic and content-sensitive', () => {
    const { root } = fakeRoot()
    const a = computeSourceFingerprint(root)
    const b = computeSourceFingerprint(root)
    expect(a.fingerprint).toBe(b.fingerprint)
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    // Editing a packaged main source changes the fingerprint.
    writeFileSync(path.join(root, 'electron', 'a.cjs'), 'module.exports=2\n')
    expect(computeSourceFingerprint(root).fingerprint).not.toBe(a.fingerprint)
  })

  it('ignores *.test.cjs (test-only edits do not invalidate an artifact)', () => {
    const { root } = fakeRoot()
    const before = computeSourceFingerprint(root).fingerprint
    writeFileSync(path.join(root, 'electron', 'a.test.cjs'), 'test noise\n')
    expect(computeSourceFingerprint(root).fingerprint).toBe(before)
  })
})

describe('buildAttestation', () => {
  it('records the current-source kind, version and a fresh nonce', () => {
    const { root } = fakeRoot({ version: '1.2.3' })
    const m = buildAttestation(root)
    expect(m.artifact_kind).toBe(ARTIFACT_KIND)
    expect(m.app_version).toBe('1.2.3')
    expect(m.build_nonce).toMatch(/^[0-9a-f]{32}$/)
    expect(m.source_fingerprint).toBe(computeSourceFingerprint(root).fingerprint)
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
    const root = mkdtempSync(path.join(os.tmpdir(), 'attest-empty-'))
    created.push(root)
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1', main: 'm', build: {} }))
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
