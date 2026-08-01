import { describe, expect, it } from 'vitest'
import { find7z, proveContainment } from './nsis-payload.mjs'

const MANIFEST = JSON.stringify({ schema: 1, version: '0.3.3' })

describe('find7z', () => {
  it('returns null when no extractor probes true (honest fail path)', () => {
    expect(find7z(() => false)).toBeNull()
  })
  it('returns the first tool that probes true', () => {
    expect(find7z(t => t === '7z')).toBe('7z')
  })
})

describe('proveContainment — installer↔payload binding (finding 1)', () => {
  it('with NO extractor it does NOT fake a pass', () => {
    const r = proveContainment({ installerPath: 'x.exe', expectedManifestJson: MANIFEST, tool: null })
    expect(r.proven).toBe(false)
    expect(r.reason).toBe('no-nsis-extractor')
  })

  it('PROVES containment when the extracted manifest matches', () => {
    const r = proveContainment({ installerPath: 'x.exe', expectedManifestJson: MANIFEST, tool: '7z', extractEntry: () => MANIFEST })
    expect(r.proven).toBe(true)
    expect(r.method).toBe('7z')
  })

  it('REFUSES when the payload manifest differs (adversarial swap)', () => {
    const r = proveContainment({ installerPath: 'x.exe', expectedManifestJson: MANIFEST, tool: '7z', extractEntry: () => JSON.stringify({ schema: 1, version: '9.9.9' }) })
    expect(r.proven).toBe(false)
    expect(r.reason).toBe('payload-manifest-differs')
  })

  it('REFUSES when the manifest is absent from the payload', () => {
    const r = proveContainment({ installerPath: 'x.exe', expectedManifestJson: MANIFEST, tool: '7z', extractEntry: () => null })
    expect(r.proven).toBe(false)
    expect(r.reason).toBe('manifest-not-in-payload')
  })

  it('a failed extraction is an honest not-proven, not a crash', () => {
    const r = proveContainment({ installerPath: 'x.exe', expectedManifestJson: MANIFEST, tool: '7z', extractEntry: () => { throw new Error('bad archive') } })
    expect(r.proven).toBe(false)
    expect(r.reason).toMatch(/extract-failed/)
  })
})
