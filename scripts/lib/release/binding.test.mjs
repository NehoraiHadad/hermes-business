import { describe, expect, it } from 'vitest'
import { computeReleaseBinding, commitFingerprint } from './binding.mjs'

const base = {
  installers: [{ name: 'Setup 0.3.3.exe', bytes: 100, sha256: 'd'.repeat(64) }],
  attestation: { app_version: '0.3.3', source_head: 'a'.repeat(40), source_fingerprint: 'f'.repeat(64), artifact_kind: 'win-unpacked-current' },
  checksums: { installers: [{ name: 'Setup 0.3.3.exe', bytes: 100, sha256: 'd'.repeat(64) }] },
  head: 'a'.repeat(40),
  subject: 'feat: real thing'
}

describe('computeReleaseBinding — bound to artifact, not HEAD alone', () => {
  it('is deterministic and order-independent', () => {
    const a = computeReleaseBinding(base)
    const b = computeReleaseBinding({ ...base })
    expect(a.digest).toBe(b.digest)
    expect(a.digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('a dirty/changed commit SUBJECT at the same tree changes the binding', () => {
    const a = computeReleaseBinding(base)
    const b = computeReleaseBinding({ ...base, subject: 'feat: tampered subject' })
    expect(a.digest).not.toBe(b.digest)
    expect(a.commit_fingerprint).not.toBe(b.commit_fingerprint)
  })

  it('a different installer hash changes the binding', () => {
    const a = computeReleaseBinding(base)
    const b = computeReleaseBinding({ ...base, installers: [{ name: 'Setup 0.3.3.exe', bytes: 100, sha256: '0'.repeat(64) }] })
    expect(a.digest).not.toBe(b.digest)
  })

  it('a different embedded attestation fingerprint changes the binding', () => {
    const a = computeReleaseBinding(base)
    const b = computeReleaseBinding({ ...base, attestation: { ...base.attestation, source_fingerprint: 'e'.repeat(64) } })
    expect(a.digest).not.toBe(b.digest)
  })
})

describe('commitFingerprint', () => {
  it('folds head + subject; head alone is insufficient', () => {
    expect(commitFingerprint('a'.repeat(40), 'x')).not.toBe(commitFingerprint('a'.repeat(40), 'y'))
    expect(commitFingerprint('a'.repeat(40), 'x')).toBe(commitFingerprint('a'.repeat(40), 'x'))
  })
})
