import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isUnder, normalizePathForCompare } from './path-containment.cjs'

const isWin = process.platform === 'win32'

describe('normalizePathForCompare', () => {
  it('trims a trailing separator', () => {
    expect(normalizePathForCompare(`C:${path.sep}foo${path.sep}`)).toBe(
      normalizePathForCompare(`C:${path.sep}foo`)
    )
  })

  it('trims multiple trailing separators', () => {
    expect(normalizePathForCompare(`/foo/bar///`)).toBe(normalizePathForCompare('/foo/bar'))
  })

  if (isWin) {
    it('case-folds on win32', () => {
      expect(normalizePathForCompare('C:\\Foo\\BAR')).toBe(normalizePathForCompare('c:\\foo\\bar'))
    })
  } else {
    it('is case-exact on POSIX', () => {
      expect(normalizePathForCompare('/Foo/BAR')).not.toBe(normalizePathForCompare('/foo/bar'))
    })
  }
})

describe('isUnder', () => {
  const parent = path.join(path.sep, 'hermes-home')
  const child = path.join(parent, 'business-state', 'file.json')

  it('true for an exact match', () => {
    expect(isUnder(parent, parent)).toBe(true)
  })

  it('true for a nested descendant', () => {
    expect(isUnder(child, parent)).toBe(true)
  })

  // NOTE: qa-runtime-policy.cjs's isUnder always appended a separator boundary via
  // `p + normCompare(path.sep)`, but normCompare trims ALL trailing separators —
  // including a lone path.sep — down to '', so that append is actually a no-op.
  // A sibling directory sharing a path PREFIX (not a real ancestor) is therefore
  // reported as "under" the parent. This is a latent gap in the ORIGINAL
  // qa-runtime-policy.cjs logic, ported here byte-for-byte per the consolidation's
  // instruction to preserve that file's exact semantics (security-critical,
  // existing tests must stay green) — flagged separately, not fixed here.
  it('a sibling sharing only a path PREFIX is (incorrectly) reported as under — documents the inherited gap, not desired behavior', () => {
    const sibling = `${parent}-other`
    expect(isUnder(sibling, parent)).toBe(true)
  })

  it('false for an unrelated path', () => {
    expect(isUnder(path.join(path.sep, 'elsewhere'), parent)).toBe(false)
  })

  it('true regardless of a trailing separator on either side', () => {
    expect(isUnder(`${child}`, `${parent}${path.sep}`)).toBe(true)
  })

  if (isWin) {
    it('true across case differences on win32', () => {
      expect(isUnder('C:\\Hermes-Home\\Business-State\\file.json', 'c:\\hermes-home')).toBe(true)
    })
  }
})
