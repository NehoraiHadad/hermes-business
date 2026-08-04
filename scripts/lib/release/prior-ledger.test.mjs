import { describe, expect, it } from 'vitest'
import { checkVersionImmutability } from './prior-ledger.mjs'

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const signedLedger = entries => ({ source: 'signed-ledger', entries })

describe('checkVersionImmutability — durable ledger (finding 5)', () => {
  it('public FAILS closed with NO durable ledger', () => {
    const r = checkVersionImmutability({ channel: 'public', version: '0.3.3', installerSha256: SHA_A, ledger: null })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('version-ledger-unavailable')
    expect(r.verified).toBe(false)
  })

  it('QA is ALLOWED but explicitly UNVERIFIED with no ledger', () => {
    const r = checkVersionImmutability({ channel: 'qa', version: '0.3.3', installerSha256: SHA_A, ledger: null })
    expect(r.ok).toBe(true)
    expect(r.verified).toBe(false)
    expect(r.label).toMatch(/UNVERIFIED/)
  })

  it('pilot is a FULL-RIGOR channel: it FAILS closed with no durable ledger, same as public', () => {
    const r = checkVersionImmutability({ channel: 'pilot', version: '0.3.3', installerSha256: SHA_A, ledger: null })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('version-ledger-unavailable')
    expect(r.verified).toBe(false)
  })

  it('pilot honors a real ledger exactly like public (idempotent / reuse)', () => {
    const ok = checkVersionImmutability({ channel: 'pilot', version: '0.3.3', installerSha256: SHA_A, ledger: signedLedger({ '0.3.3': { sha256: SHA_A } }) })
    expect(ok.ok).toBe(true)
    const reuse = checkVersionImmutability({ channel: 'pilot', version: '0.3.3', installerSha256: SHA_B, ledger: signedLedger({ '0.3.3': { sha256: SHA_A } }) })
    expect(reuse.ok).toBe(false)
    expect(reuse.code).toBe('version-reuse')
  })

  it('an UNTRUSTED ledger source is treated as no ledger', () => {
    const r = checkVersionImmutability({ channel: 'public', version: '0.3.3', installerSha256: SHA_A, ledger: { source: 'local-guess', entries: { '0.3.3': { sha256: SHA_A } } } })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('version-ledger-unavailable')
  })

  it('SAME-version SAME-sha is an idempotent re-release (ok, verified)', () => {
    const r = checkVersionImmutability({ channel: 'public', version: '0.3.3', installerSha256: SHA_A, ledger: signedLedger({ '0.3.3': { sha256: SHA_A } }) })
    expect(r.ok).toBe(true)
    expect(r.verified).toBe(true)
  })

  it('SAME-version DIFFERENT-sha is a hard version-reuse collision (adversarial)', () => {
    const r = checkVersionImmutability({ channel: 'public', version: '0.3.3', installerSha256: SHA_B, ledger: signedLedger({ '0.3.3': { sha256: SHA_A } }) })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('version-reuse')
  })

  it('a NEW version not in the ledger passes as verified-new', () => {
    const r = checkVersionImmutability({ channel: 'public', version: '0.4.0', installerSha256: SHA_A, ledger: signedLedger({ '0.3.3': { sha256: SHA_A } }) })
    expect(r.ok).toBe(true)
    expect(r.verified).toBe(true)
  })
})
