import { describe, expect, it } from 'vitest'
import { verifyChecksums, versionFromInstallerName, sha256 } from './checksums.mjs'

describe('versionFromInstallerName', () => {
  it('extracts x.y.z from a Setup file name', () => {
    expect(versionFromInstallerName('העוזר לעסק Setup 0.3.3.exe')).toBe('0.3.3')
    expect(versionFromInstallerName('App Setup 1.2.0-beta.1.exe')).toBe('1.2.0-beta.1')
    expect(versionFromInstallerName('no-version.exe')).toBeNull()
  })
})

describe('verifyChecksums — fails closed on any disagreement', () => {
  const bin = { name: 'Setup 0.3.3.exe', bytes: 100, sha256: 'a'.repeat(64) }
  const manifest = { installers: [{ name: 'Setup 0.3.3.exe', bytes: 100, sha256: 'a'.repeat(64) }] }

  it('accepts a manifest that matches the bytes on disk', () => {
    expect(verifyChecksums(manifest, [bin]).ok).toBe(true)
  })
  it('rejects a hash disagreement (the stale-checksums incident)', () => {
    const r = verifyChecksums({ installers: [{ name: 'Setup 0.3.3.exe', bytes: 100, sha256: 'b'.repeat(64) }] }, [bin])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/sha256/)
  })
  it('rejects a byte-size disagreement', () => {
    const r = verifyChecksums({ installers: [{ name: 'Setup 0.3.3.exe', bytes: 999, sha256: 'a'.repeat(64) }] }, [bin])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/bytes/)
  })
  it('rejects a binary with no manifest entry', () => {
    expect(verifyChecksums({ installers: [] }, [bin]).ok).toBe(false)
  })
  it('rejects a manifest entry with no binary on disk', () => {
    const r = verifyChecksums(manifest, [])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/no matching binary/)
  })
  it('rejects a missing manifest', () => {
    expect(verifyChecksums(null, [bin]).ok).toBe(false)
  })
})

describe('sha256', () => {
  it('hashes a buffer to 64 hex chars', () => {
    expect(sha256(Buffer.from('x'))).toMatch(/^[0-9a-f]{64}$/)
  })
})
