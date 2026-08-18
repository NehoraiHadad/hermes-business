import { describe, expect, it } from 'vitest'
import { expectedInstallerName, verifyArtifactSet } from './artifact-set.mjs'

// D3 (docs/specs/versioning.md): the expected installer name is a FIXED ASCII
// template — it does not depend on productName (which stays the Hebrew
// productName in package.json; only the artifact file name is ASCII).
const PROD = "תכל'ס"
const V = '0.3.3'
const EXPECTED = `Tachles-Setup-${V}.exe`
const good = () => ({ productName: PROD, version: V, installers: [{ name: EXPECTED }] })

describe('verifyArtifactSet — exact expected set (finding 9)', () => {
  it('accepts exactly the one expected versioned installer (ASCII name, D3)', () => {
    const r = verifyArtifactSet(good())
    expect(r.ok).toBe(true)
    expect(r.expected).toBe(EXPECTED)
  })

  it('rejects a MISSING installer', () => {
    expect(verifyArtifactSet({ productName: PROD, version: V, installers: [] }).ok).toBe(false)
  })

  // An empty set means "nothing was packaged" OR "selection matched several
  // leftovers and refused to guess". Reporting only the first sends the operator
  // to rebuild when the fix is to delete one stale file from release/.
  it('reports the SELECTION reason when the empty set came from a collision', () => {
    const r = verifyArtifactSet({
      productName: PROD, version: V, installers: [],
      selectionErrors: [`expected exactly one companion installer for ${V}; found 2`]
    })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/found 2/)
  })

  it('falls back to the plain message when no selection reason is supplied', () => {
    const r = verifyArtifactSet({ productName: PROD, version: V, installers: [] })
    expect(r.errors.join(' ')).toMatch(/no installer \.exe present under release\//)
  })

  it('rejects an EXTRA installer alongside the expected one', () => {
    const r = verifyArtifactSet({ productName: PROD, version: V, installers: [
      { name: EXPECTED }, { name: 'random-tool.exe' }
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
    const r = verifyArtifactSet({ productName: PROD, version: V, installers: [{ name: 'Tachles-Setup-0.3.2.exe' }] })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/v0\.3\.2|unexpected/)
  })

  it('rejects the OLD Hebrew "${productName} Setup ${version}.exe" template (D3 migration)', () => {
    const r = verifyArtifactSet({ productName: PROD, version: V, installers: [{ name: `${PROD} Setup ${V}.exe` }] })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/unexpected/)
  })

  it('expectedInstallerName ignores productName and composes the fixed ASCII template + version', () => {
    expect(expectedInstallerName('App', '1.2.3')).toBe('Tachles-Setup-1.2.3.exe')
    expect(expectedInstallerName("תכל'ס", '1.2.3')).toBe('Tachles-Setup-1.2.3.exe')
  })
})
