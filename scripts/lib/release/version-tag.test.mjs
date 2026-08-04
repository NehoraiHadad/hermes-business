import { describe, expect, it } from 'vitest'
import { decideVersionTag, parseTagVersion } from './version-tag.mjs'

describe('parseTagVersion', () => {
  it('extracts the semver from a v<semver> tag', () => {
    expect(parseTagVersion('v0.4.0-alpha.2')).toBe('0.4.0-alpha.2')
    expect(parseTagVersion('v1.2.3')).toBe('1.2.3')
  })
  it('rejects a tag with no leading v, or a malformed one', () => {
    expect(parseTagVersion('0.4.0-alpha.2')).toBeNull()
    expect(parseTagVersion('release-0.4.0')).toBeNull()
    expect(parseTagVersion('v0.4')).toBeNull()
    expect(parseTagVersion('')).toBeNull()
    expect(parseTagVersion(undefined)).toBeNull()
  })
})

describe('decideVersionTag — naming check only (no git collaborators injected)', () => {
  it('passes when the tag names exactly the current package.json version', () => {
    const r = decideVersionTag({ tag: 'v0.4.0-alpha.2', packageVersion: '0.4.0-alpha.2' })
    expect(r.ok).toBe(true)
    expect(r.version).toBe('0.4.0-alpha.2')
  })
  it('rejects a malformed tag', () => {
    const r = decideVersionTag({ tag: 'v0.4', packageVersion: '0.4.0-alpha.2' })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('tag-not-semver')
  })
  it('rejects a tag naming a DIFFERENT version than package.json', () => {
    const r = decideVersionTag({ tag: 'v0.4.0-alpha.1', packageVersion: '0.4.0-alpha.2' })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('version-mismatch')
  })
  it('rejects when package.json carries no version at all', () => {
    const r = decideVersionTag({ tag: 'v1.0.0', packageVersion: undefined })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('package-version-missing')
  })
})

describe('decideVersionTag — WITH git collaborators (tag ↔ HEAD proof)', () => {
  const SHA = 'a'.repeat(40)
  const OTHER = 'b'.repeat(40)

  it('passes when the tag exists AND points at the current HEAD', () => {
    const r = decideVersionTag({
      tag: 'v0.4.0-alpha.2', packageVersion: '0.4.0-alpha.2',
      resolveTagCommit: () => SHA, currentHead: () => SHA
    })
    expect(r.ok).toBe(true)
  })
  it('rejects a tag that does not exist in git', () => {
    const r = decideVersionTag({
      tag: 'v0.4.0-alpha.2', packageVersion: '0.4.0-alpha.2',
      resolveTagCommit: () => null, currentHead: () => SHA
    })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('tag-not-found')
  })
  it('rejects when HEAD cannot be resolved', () => {
    const r = decideVersionTag({
      tag: 'v0.4.0-alpha.2', packageVersion: '0.4.0-alpha.2',
      resolveTagCommit: () => SHA, currentHead: () => null
    })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('head-unresolvable')
  })
  it('ADVERSARIAL: tag exists but points at a DIFFERENT commit than HEAD', () => {
    const r = decideVersionTag({
      tag: 'v0.4.0-alpha.2', packageVersion: '0.4.0-alpha.2',
      resolveTagCommit: () => OTHER, currentHead: () => SHA
    })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('tag-not-head')
  })
  it('a version mismatch is caught BEFORE any git collaborator is even consulted', () => {
    let called = false
    const r = decideVersionTag({
      tag: 'v9.9.9', packageVersion: '0.4.0-alpha.2',
      resolveTagCommit: () => { called = true; return SHA }, currentHead: () => SHA
    })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('version-mismatch')
    expect(called).toBe(false)
  })
})
