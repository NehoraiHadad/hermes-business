import { afterEach, describe, expect, it } from 'vitest'
import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { computeSourceFingerprint } from './build-attestation.mjs'
import { fakeRoot, cleanupRoots } from './attest-fixtures.mjs'

// computeSourceFingerprint now spans the COMPLETE packaged-source input set (see
// subject-registry.mjs), not only electron/**/*.cjs — so ANY packaged-source
// drift invalidates a prepared artifact, while non-shipped drift does not.

afterEach(cleanupRoots)

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

  it('spans the WHOLE packaged input set: renderer / plugin / installer / asset drift invalidates', () => {
    // Regression for the incident-narrowing bug: the fingerprint covered only
    // electron/**/*.cjs, so drift in any OTHER packaged source shipped silently.
    for (const [rel, body] of [
      ['src/main.tsx', 'export const x = 2\n'], // renderer source vite compiles into dist
      ['index.html', '<!doctype html><title>x</title>\n'], // renderer entry
      ['hermes-plugin/business-shell/plugin.js', 'module.exports={v:2}\n'], // plugin
      ['installer/bootstrap.ps1', 'Write-Host bye\n'], // extraResource installer script
      ['build/icon.png', 'PNG-changed'], // packaged asset
      ['scripts/after-pack.cjs', 'exports.default=async()=>2\n'], // rcedit build transform
      ['scripts/build-plugin.mjs', 'export const v=2\n'], // plugin bundler transform
      ['scripts/lib/community/generate.mjs', 'export const gen=2\n'], // community runtime payload
      ['assets/community-skills/community-bootstrap/SKILL.md', '# bootstrap v2\n'] // shipped skill body
    ]) {
      const { root, put } = fakeRoot()
      const before = computeSourceFingerprint(root).fingerprint
      put(rel, body)
      expect(computeSourceFingerprint(root).fingerprint, `${rel} must invalidate`).not.toBe(before)
    }
  }, 15_000)

  it('does NOT invalidate on non-shipped drift (tests, node_modules, generated dist, docs)', () => {
    const { root, put } = fakeRoot()
    const before = computeSourceFingerprint(root).fingerprint
    put('src/foo.test.tsx', 'test only\n')
    put('hermes-plugin/business-shell/tests/test_x.py', 'assert True\n')
    put('hermes-plugin/business-shell/__pycache__/x.pyc', 'bytecode')
    put('dist/assets/index-abc.js', 'generated output\n')
    put('docs/whatever.md', '# doc\n')
    expect(computeSourceFingerprint(root).fingerprint).toBe(before)
  })

  it('fails closed when a declared packaged source is missing', () => {
    const { root } = fakeRoot()
    rmSync(path.join(root, 'installer', 'bootstrap.ps1'))
    expect(() => computeSourceFingerprint(root)).toThrow(/bootstrap\.ps1/)
  })
})
