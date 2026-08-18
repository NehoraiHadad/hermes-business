import { describe, expect, it } from 'vitest'
import { releaseDirtyInputs, GIT_UNAVAILABLE } from './dirty-tree.mjs'

// The parsing and the membership rules are proven in porcelain.test.mjs. What is
// only provable here is the failure posture of the git call itself: an
// unreadable tree must NOT be reported as a clean one.
const record = (...paths) => paths.map(p => ` M ${p}\0`).join('')

describe('releaseDirtyInputs', () => {
  it('reports the release inputs among the changed paths', () => {
    const out = releaseDirtyInputs('/repo', { runGit: () => record('package.json', 'README.md') })
    expect(out).toContain('package.json')
    expect(out).not.toContain('README.md')
  })

  it('is empty for a clean tree', () => {
    expect(releaseDirtyInputs('/repo', { runGit: () => '' })).toEqual([])
  })

  it('FAILS CLOSED when git cannot run — never an empty (= clean) answer', () => {
    const out = releaseDirtyInputs('/repo', { runGit: () => { throw new Error('git: not found') } })
    expect(out).toEqual([GIT_UNAVAILABLE])
    // The distinction that matters: callers treat a non-empty list as "dirty",
    // so an unprovable tree blocks exactly like a dirty one.
    expect(out.length).toBeGreaterThan(0)
  })
})
