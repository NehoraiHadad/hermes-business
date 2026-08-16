import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  assertRunningVersionSupported,
  assertUpdateMethodSupported,
  captureInstallCommit,
  classifyInstallMethod,
  gitFetchOrigin,
  installRepoRoot,
  resetInstallCheckout
} from './hermes-compat.cjs'
import { execFileSync } from 'node:child_process'

// A path that is provably NOT a git work tree and not the managed layout, so
// every classification below is deterministic regardless of whether git is
// installed on the runner.
const BOGUS = path.join(path.sep, 'definitely', 'not', 'hermes', 'venv', 'bin', 'hermes')

describe('classifyInstallMethod', () => {
  it('returns "unknown" for a null command', () => {
    expect(classifyInstallMethod(null)).toBe('unknown')
  })

  it('returns "unknown" for a path that is neither a git checkout nor the managed layout', () => {
    expect(classifyInstallMethod(BOGUS)).toBe('unknown')
  })
})

// A fake MANAGED (native/ZIP) layout: <tmp>/hermes-agent/pyproject.toml with the
// executable three levels below hermes-agent. os.tmpdir() is outside any git work
// tree, so isGitInstall() is false and it classifies as 'managed'.
const managedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-managed-'))
const managedAgent = path.join(managedRoot, 'hermes-agent')
fs.mkdirSync(path.join(managedAgent, 'venv', 'bin'), { recursive: true })
fs.writeFileSync(path.join(managedAgent, 'pyproject.toml'), '[project]\nname="hermes"\n')
const MANAGED_CMD = path.join(managedAgent, 'venv', 'bin', 'hermes')

afterAll(() => {
  fs.rmSync(managedRoot, { recursive: true, force: true })
})

describe('classifyInstallMethod (managed layout)', () => {
  it('classifies a native/ZIP hermes-agent+pyproject layout as "managed"', () => {
    expect(classifyInstallMethod(MANAGED_CMD)).toBe('managed')
  })
})

describe('assertUpdateMethodSupported', () => {
  it('refuses a managed (native/ZIP) install — no proven automatic rollback', () => {
    expect(() => assertUpdateMethodSupported(MANAGED_CMD)).toThrow(/מנוהלת|שחזור אוטומטי/)
  })

  it('throws (gating the update) for an unrecognized install method', () => {
    expect(() => assertUpdateMethodSupported(BOGUS)).toThrow(/התקנת git|שיטת התקנה נתמכת/)
    expect(() => assertUpdateMethodSupported(null)).toThrow()
  })
})

describe('pinned community git installs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-pinned-'))
  const repo = path.join(root, 'hermes-agent')
  const command = path.join(repo, 'venv', 'bin', 'hermes')

  try {
    fs.mkdirSync(path.dirname(command), { recursive: true })
    execFileSync('git', ['init', repo], { stdio: 'ignore' })
    execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.invalid'])
    execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test'])
    fs.writeFileSync(path.join(repo, 'pyproject.toml'), '[project]\nname="hermes"\n')
    execFileSync('git', ['-C', repo, 'add', 'pyproject.toml'])
    execFileSync('git', ['-C', repo, 'commit', '-m', 'fixture'], { stdio: 'ignore' })
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/NehoraiHadad/hermes-agent.git'])
  } catch {
    // Assertions below expose a missing git fixture as unknown instead of
    // hiding a production classification failure.
  }

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

  it('classifies a fork checkout as pinned and refuses auto-update', () => {
    expect(classifyInstallMethod(command)).toBe('pinned')
    expect(() => assertUpdateMethodSupported(command)).toThrow(/נעוץ|קהילה מאומתת/)
  })
})

describe('gitFetchOrigin', () => {
  it('reports not-git for a non-git install without shelling out', () => {
    expect(gitFetchOrigin(BOGUS)).toEqual({ ok: false, reason: 'not-git' })
  })
})

describe('assertRunningVersionSupported (post-update re-gate)', () => {
  it('accepts and returns a trimmed in-range version (bare or `hermes X.Y.Z`)', () => {
    expect(assertRunningVersionSupported('0.19.0')).toBe('0.19.0')
    expect(assertRunningVersionSupported('hermes 0.19.9')).toBe('hermes 0.19.9')
  })

  it('throws (out of range) for a version at or above the exclusive max', () => {
    expect(assertRunningVersionSupported('0.20.1')).toBe('0.20.1')
    expect(() => assertRunningVersionSupported('0.21.0')).toThrow(/חורגת מהטווח הנתמך/)
    expect(() => assertRunningVersionSupported('0.18.9')).toThrow(/חורגת מהטווח הנתמך/)
  })

  it('throws (unresolvable) when no version can be parsed', () => {
    expect(() => assertRunningVersionSupported(null)).toThrow(/לא ניתן לאמת/)
    expect(() => assertRunningVersionSupported('')).toThrow(/לא ניתן לאמת/)
    expect(() => assertRunningVersionSupported('command not found')).toThrow(/לא ניתן לאמת/)
  })
})

describe('captureInstallCommit', () => {
  it('returns null for a null command', () => {
    expect(captureInstallCommit(null)).toBeNull()
  })

  it('returns null when the install is not a git checkout', () => {
    expect(captureInstallCommit(BOGUS)).toBeNull()
  })
})

describe('resetInstallCheckout', () => {
  it('refuses (not-git) when the install is not a git checkout', () => {
    expect(resetInstallCheckout(BOGUS, 'a1b2c3d4')).toEqual({ ok: false, reason: 'not-git' })
  })
})

describe('installRepoRoot', () => {
  it('resolves three levels up from the executable (venv/Scripts/hermes)', () => {
    const root = installRepoRoot(path.join('X', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe'))
    expect(path.basename(root)).toBe('hermes-agent')
  })
})
