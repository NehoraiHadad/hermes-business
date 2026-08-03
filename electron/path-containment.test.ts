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

  // Regression: the implementation inherited from qa-runtime-policy.cjs appended
  // the boundary via `p + normCompare(path.sep)`, but normCompare trims a lone
  // path.sep down to '', so the append was a no-op and isUnder degenerated to a
  // raw string-prefix check that accepted siblings sharing only a name prefix
  // (security-relevant: a `<tmpdir>-evil` sibling passed the fail-closed QA-home
  // must-be-under-TEMP validation). The separator is now appended un-normalized.
  it('a sibling sharing only a path PREFIX is NOT under the parent', () => {
    const sibling = `${parent}-other`
    expect(isUnder(sibling, parent)).toBe(false)
    expect(isUnder(path.join(sibling, 'payload'), parent)).toBe(false)
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
