import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ApplyRefusedError, applyArtifacts, assertSafeRelPath, classifyTarget } from './apply.mjs'

const created = []
function tmpDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'community-apply-'))
  created.push(dir)
  return dir
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

const artifacts = () => ({
  'config.yaml': 'gateway:\n  multiplex_profiles: true\n',
  'profiles/main/SOUL.md': '# תכלס\n',
  'profiles/main/skills/general/SKILL.md': '---\nname: general\n---\nידע\n'
})

describe('HERMES_HOME heuristic (fail-closed targeting)', () => {
  it('REFUSES a non-empty directory without config.yaml — even with --init', () => {
    const dir = tmpDir()
    writeFileSync(path.join(dir, 'somebody-elses-file.txt'), 'data')
    expect(() => applyArtifacts(dir, artifacts())).toThrow(ApplyRefusedError)
    expect(() => applyArtifacts(dir, artifacts(), { init: true })).toThrow(/does not look like a HERMES_HOME/)
    // Nothing was written before the refusal.
    expect(existsSync(path.join(dir, 'config.yaml'))).toBe(false)
  })

  it('REFUSES an empty or absent directory without an explicit init', () => {
    expect(() => applyArtifacts(tmpDir(), artifacts())).toThrow(/--init/)
    expect(() => applyArtifacts(path.join(tmpDir(), 'new-home'), artifacts())).toThrow(/--init/)
  })

  it('REFUSES a file target', () => {
    const dir = tmpDir()
    const file = path.join(dir, 'a-file')
    writeFileSync(file, 'x')
    expect(() => applyArtifacts(file, artifacts(), { init: true })).toThrow(/not a directory/)
  })

  it('classifies targets for CLI messaging', () => {
    const home = tmpDir()
    writeFileSync(path.join(home, 'config.yaml'), 'x: 1\n')
    expect(classifyTarget(home)).toBe('hermes-home')
    expect(classifyTarget(tmpDir())).toBe('empty')
    expect(classifyTarget(path.join(tmpDir(), 'nope'))).toBe('absent')
  })
})

describe('writing + idempotency', () => {
  it('initializes an empty dir with --init and writes every artifact', () => {
    const dir = tmpDir()
    const result = applyArtifacts(dir, artifacts(), { init: true })
    expect(result.written.sort()).toEqual(Object.keys(artifacts()).sort())
    expect(result.unchanged).toEqual([])
    expect(readFileSync(path.join(dir, 'profiles/main/SOUL.md'), 'utf8')).toBe('# תכלס\n')
  })

  it('creates an ABSENT dir with --init', () => {
    const dir = path.join(tmpDir(), 'fresh-home')
    const result = applyArtifacts(dir, artifacts(), { init: true })
    expect(result.written.length).toBe(3)
    expect(existsSync(path.join(dir, 'config.yaml'))).toBe(true)
  })

  it('is idempotent: a second identical apply reports everything unchanged and rewrites nothing', () => {
    const dir = tmpDir()
    applyArtifacts(dir, artifacts(), { init: true })
    const second = applyArtifacts(dir, artifacts())
    expect(second.written).toEqual([])
    expect(second.unchanged.sort()).toEqual(Object.keys(artifacts()).sort())
  })

  it('rewrites ONLY the artifacts whose content changed', () => {
    const dir = tmpDir()
    applyArtifacts(dir, artifacts(), { init: true })
    const changed = { ...artifacts(), 'profiles/main/SOUL.md': '# תכלס v2\n' }
    const result = applyArtifacts(dir, changed)
    expect(result.written).toEqual(['profiles/main/SOUL.md'])
    expect(result.unchanged.length).toBe(2)
  })

  it('NEVER deletes files it did not generate (stale profile survives)', () => {
    const dir = tmpDir()
    applyArtifacts(dir, artifacts(), { init: true })
    const stale = path.join(dir, 'profiles/removed-group/SOUL.md')
    mkdirSync(path.dirname(stale), { recursive: true })
    writeFileSync(stale, 'old persona')
    const onlyConfig = { 'config.yaml': artifacts()['config.yaml'] }
    applyArtifacts(dir, onlyConfig)
    expect(readFileSync(stale, 'utf8')).toBe('old persona')
    expect(existsSync(path.join(dir, 'profiles/main/SOUL.md'))).toBe(true)
  })
})

describe('artifact path safety', () => {
  it('rejects traversal, absolute and drive-letter paths before ANY write', () => {
    for (const bad of ['../escape.txt', '/abs.txt', 'C:/abs.txt', 'a/../../b', '']) {
      expect(() => assertSafeRelPath(bad)).toThrow(ApplyRefusedError)
    }
    const dir = tmpDir()
    writeFileSync(path.join(dir, 'config.yaml'), 'x: 1\n')
    expect(() => applyArtifacts(dir, { '../escape.txt': 'nope' })).toThrow(/unsafe artifact path/)
    expect(existsSync(path.join(path.dirname(dir), 'escape.txt'))).toBe(false)
  })

  it('accepts normal nested relative paths', () => {
    expect(() => assertSafeRelPath('profiles/main/skills/general/SKILL.md')).not.toThrow()
  })
})
