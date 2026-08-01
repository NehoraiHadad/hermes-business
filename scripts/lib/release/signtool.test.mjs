import { describe, expect, it } from 'vitest'
import { parseSigntool, verifySigntool, probeSignature } from './signtool.mjs'

const OK = `Verifying: app.exe
Signing Certificate Chain:
    Issued to: Contoso, Inc.
    Issued by: DigiCert Trusted G4 Code Signing RSA4096 SHA384 2021 CA1
    SHA1 hash: AA BB CC DD EE FF 00 11 22 33 44 55 66 77 88 99 AA BB CC DD

The signature is timestamped: Wed Jan 01 00:00:00 2025
Timestamp Verified by:
    Issued to: DigiCert Timestamp 2023

Successfully verified: app.exe`

const NO_TS = `Verifying: app.exe
Signing Certificate Chain:
    Issued to: Contoso, Inc.
    SHA1 hash: AABBCCDD

SignTool Error: No timestamp found.`

describe('parseSigntool — /pa /tw output (finding 8)', () => {
  it('parses a verified, timestamped signature (exit 0)', () => {
    const r = parseSigntool(OK, 0)
    expect(r.verified).toBe(true)
    expect(r.publisher).toBe('Contoso, Inc.')
    expect(r.rfc3161).toBe(true)
    expect(r.thumbprint).toBe('AABBCCDDEEFF00112233445566778899AABBCCDD')
  })
  it('a NON-ZERO exit is NOT verified even if text looks partial (RFC3161/signtool result)', () => {
    const r = parseSigntool(NO_TS, 1)
    expect(r.verified).toBe(false)
    expect(r.rfc3161).toBe(false)
  })
})

describe('verifySigntool — read-only, injectable', () => {
  it('off-Windows → undetectable, never a pass', () => {
    expect(verifySigntool('x.exe', { platform: 'linux', run: () => ({ stdout: OK, code: 0 }) })).toEqual({ detectable: false })
  })
  it('missing signtool (runner throws) → undetectable', () => {
    const r = verifySigntool('x.exe', { platform: 'win32', run: () => { throw new Error('ENOENT signtool') } })
    expect(r).toEqual({ detectable: false })
  })
  it('probeSignature classifies a verified run as valid+trusted', () => {
    const s = probeSignature('x.exe', { platform: 'win32', run: () => ({ stdout: OK, code: 0 }) })
    expect(s.valid).toBe(true)
    expect(s.trustedTimestamp).toBe(true)
  })
  it('TOOL WIRING: invokes the INJECTED absolute signtool path (not a bare PATH name)', () => {
    let usedExe = null
    const s = probeSignature('x.exe', {
      platform: 'win32',
      exe: 'C:/abs/vendor/signtool.exe',
      run: (file, exe) => { usedExe = exe; return { stdout: OK, code: 0 } }
    })
    expect(usedExe).toBe('C:/abs/vendor/signtool.exe')
    expect(s.valid).toBe(true)
  })
})
