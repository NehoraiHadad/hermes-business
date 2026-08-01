import { describe, expect, it } from 'vitest'
import { expectedInstallerName, verifyArtifactSet } from './artifact-set.mjs'

// Uses the real (non-ASCII) product name this project ships, to prove versioned
// naming holds for Hebrew installer names too.
const PROD = 'העוזר לעסק'
const V = '0.3.3'
const good = () => ({ productName: PROD, version: V, installers: [{ name: `${PROD} Setup ${V}.exe` }] })

describe('verifyArtifactSet — exact expected set (finding 9)', () => {
  it('accepts exactly the one expected versioned installer (non-ASCII name)', () => {
    const r = verifyArtifactSet(good())
    expect(r.ok).toBe(true)
    expect(r.expected).toBe(`${PROD} Setup ${V}.exe`)
  })

  it('rejects a MISSING installer', () => {
    expect(verifyArtifactSet({ productName: PROD, version: V, installers: [] }).ok).toBe(false)
  })

  it('rejects an EXTRA installer alongside the expected one', () => {
    const r = verifyArtifactSet({ productName: PROD, version: V, installers: [
      { name: `${PROD} Setup ${V}.exe` }, { name: 'random-tool.exe' }
    ] })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/unparseable|extra|exactly 1/)
  })

  it('rejects an UNPARSEABLE name (no version token)', () => {
    const r = verifyArtifactSet({ productName: PROD, version: V, installers: [{ name: 'Installer.exe' }] })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/unparseable/)
  })

  it('rejects a WRONG-VERSION or wrong-name installer', () => {
    const r = verifyArtifactSet({ productName: PROD, version: V, installers: [{ name: `${PROD} Setup 0.3.2.exe` }] })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/v0\.3\.2|unexpected/)
  })

  it('expectedInstallerName composes productName + version', () => {
    expect(expectedInstallerName('App', '1.2.3')).toBe('App Setup 1.2.3.exe')
  })
})
