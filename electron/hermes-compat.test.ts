import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  assertRunningVersionSupported,
  assertUpdateMethodSupported,
  captureInstallCommit,
  classifyInstallMethod,
  installRepoRoot,
  resetInstallCheckout
} from './hermes-compat.cjs'

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

describe('assertUpdateMethodSupported', () => {
  it('throws (gating the update) for an unrecognized install method', () => {
    expect(() => assertUpdateMethodSupported(BOGUS)).toThrow(/שיטת התקנה נתמכת/)
    expect(() => assertUpdateMethodSupported(null)).toThrow()
  })
})

describe('assertRunningVersionSupported (post-update re-gate)', () => {
  it('accepts and returns a trimmed in-range version (bare or `hermes X.Y.Z`)', () => {
    expect(assertRunningVersionSupported('0.19.0')).toBe('0.19.0')
    expect(assertRunningVersionSupported('hermes 0.19.9')).toBe('hermes 0.19.9')
  })

  it('throws (out of range) for a version at or above the exclusive max', () => {
    expect(() => assertRunningVersionSupported('0.20.0')).toThrow(/חורגת מהטווח הנתמך/)
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
