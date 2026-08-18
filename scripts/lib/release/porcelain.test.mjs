import { describe, expect, it } from 'vitest'
import {
  parsePorcelainZ, affectedPaths, matchesSelector, isReleaseDirtyInput, dirtyReleaseInputs
} from './porcelain.mjs'

const NUL = '\0'
// Build a -z stream from [xy, path, orig?] tuples the way git emits it.
function z(...records) {
  let s = ''
  for (const [xy, p, orig] of records) {
    s += `${xy} ${p}${NUL}`
    if (orig != null) s += `${orig}${NUL}`
  }
  return s
}

describe('parsePorcelainZ — renames + non-ASCII (finding 7)', () => {
  it('parses a plain modification', () => {
    expect(parsePorcelainZ(z([' M', 'electron/main.cjs']))).toEqual([
      { x: ' ', y: 'M', path: 'electron/main.cjs', orig: null }
    ])
  })

  it('parses a rename, consuming the origin token as the next NUL field', () => {
    const recs = parsePorcelainZ(z(['R ', 'src/new name.ts', 'src/old name.ts']))
    expect(recs).toEqual([{ x: 'R', y: ' ', path: 'src/new name.ts', orig: 'src/old name.ts' }])
  })

  it('does NOT mangle a non-ASCII / spaced path (no C-quoting in -z)', () => {
    const recs = parsePorcelainZ(z(['A ', "release/תכל'ס Setup 0.3.3.exe"]))
    expect(recs[0].path).toBe("release/תכל'ס Setup 0.3.3.exe")
  })

  it('affectedPaths expands a rename to both sides', () => {
    const recs = parsePorcelainZ(z(['R ', 'electron/b.cjs', 'electron/a.cjs']))
    expect(affectedPaths(recs).sort()).toEqual(['electron/a.cjs', 'electron/b.cjs'])
  })
})

describe('registry-driven membership (finding 7)', () => {
  it('matchesSelector handles file, dir prefix, exclude and exts', () => {
    expect(matchesSelector('package.json', { file: 'package.json' })).toBe(true)
    expect(matchesSelector('electron/x.cjs', { dir: 'electron' })).toBe(true)
    expect(matchesSelector('electron/x.test.cjs', { dir: 'electron', exclude: /\.test\.cjs$/ })).toBe(false)
    expect(matchesSelector('scripts/lib/a.ps1', { dir: 'scripts/lib', exts: ['.ps1'] })).toBe(true)
    expect(matchesSelector('scripts/lib/a.mjs', { dir: 'scripts/lib', exts: ['.ps1'] })).toBe(false)
  })

  it('the LOCKFILE is a release-dirty input (finding 7)', () => {
    expect(isReleaseDirtyInput('package-lock.json')).toBe(true)
  })

  it('the transitive release-security pipeline + trust roots are release-dirty (HIGH 4)', () => {
    // A change to any containment/signing/verdict module, the engine, or the trust
    // material must block a release when uncommitted.
    expect(isReleaseDirtyInput('scripts/lib/release/containment.mjs')).toBe(true)
    expect(isReleaseDirtyInput('scripts/lib/release/signing.mjs')).toBe(true)
    expect(isReleaseDirtyInput('scripts/finalize-release.mjs')).toBe(true)
    expect(isReleaseDirtyInput('scripts/lib/subject-registry.mjs')).toBe(true)
    expect(isReleaseDirtyInput('scripts/lib/source-fingerprint.mjs')).toBe(true)
    expect(isReleaseDirtyInput('build/sign-allowlist.json')).toBe(true)
    expect(isReleaseDirtyInput('build/trust-roots.json')).toBe(true)
    expect(isReleaseDirtyInput('electron-builder.yml')).toBe(true)
  })

  it('a docs/evidence/test edit is NOT release-dirty', () => {
    expect(isReleaseDirtyInput('docs/evidence/shared-state.json')).toBe(false)
    expect(isReleaseDirtyInput('electron/main.test.cjs')).toBe(false)
    expect(isReleaseDirtyInput('README.md')).toBe(false)
  })

  it('dirtyReleaseInputs keeps only registry members, sorted & deduped', () => {
    const stream = z(
      [' M', 'electron/main.cjs'],
      [' M', 'docs/ACCEPTANCE.md'],
      ['??', 'package-lock.json'],
      ['R ', 'src/b.tsx', 'src/a.tsx']
    )
    expect(dirtyReleaseInputs(stream)).toEqual([
      'electron/main.cjs', 'package-lock.json', 'src/a.tsx', 'src/b.tsx'
    ])
  })
})
