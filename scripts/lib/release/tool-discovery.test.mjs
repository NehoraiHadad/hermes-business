import { describe, expect, it } from 'vitest'
import { discoverTool, toolDiscoveryBlocks, resolveReleaseTools } from './tool-discovery.mjs'
import { treeExists, fakeReaddir, NEW } from './tool-scan.test.mjs'

const vendor = { id: 'vendor-signtool', source: 'vendor', path: '/node_modules/@electron/windows-sign/vendor/signtool.exe', sha256_pin: 'a'.repeat(64) }
const pathSig = { id: 'system-signtool', source: 'path', path: '/usr/bin/signtool.exe' }

describe('discoverTool — prefer pinned vendor (MEDIUM 9)', () => {
  it('prefers the project-pinned vendor tool when present and hash matches', () => {
    const r = discoverTool({ candidates: [vendor, pathSig], probe: () => true, hashFile: () => 'a'.repeat(64) })
    expect(r.chosen.id).toBe('vendor-signtool')
    expect(r.chosen.source).toBe('vendor')
  })
  it('ADVERSARIAL: a swapped vendor tool (wrong hash) is rejected, falls through', () => {
    const r = discoverTool({ candidates: [vendor, pathSig], probe: () => true, hashFile: () => 'b'.repeat(64) })
    expect(r.chosen.id).toBe('system-signtool')
    expect(r.rejected.find(x => x.id === 'vendor-signtool').reason).toMatch(/swapped tool/)
  })
  it('a missing vendor tool falls back to the resolved PATH tool', () => {
    const r = discoverTool({ candidates: [vendor, pathSig], probe: c => c.source === 'path', hashFile: () => null })
    expect(r.chosen.id).toBe('system-signtool')
  })
  it('a null-path candidate is treated as not-present (no bare-name injection)', () => {
    const r = discoverTool({ candidates: [{ id: 'bare', source: 'path', path: null }], probe: () => true })
    expect(r.chosen).toBeNull()
    expect(r.rejected[0].reason).toBe('not-present')
  })
  it('no tool anywhere → available:false (advisory, NOT a standalone blocker)', () => {
    const r = discoverTool({ candidates: [vendor], probe: () => false })
    expect(r.available).toBe(false)
    expect(r.chosen).toBeNull()
    expect(toolDiscoveryBlocks()).toBe(false)
  })
  it('a 7za cache candidate with no pin is accepted on presence alone', () => {
    const seven = { id: '7za-cache', source: 'cache', path: '/cache/7zip/7za.exe' }
    const r = discoverTool({ candidates: [seven], probe: () => true, hashFile: () => 'c'.repeat(64) })
    expect(r.chosen.id).toBe('7za-cache')
    expect(r.chosen.sha256).toBe('c'.repeat(64))
  })
  it('verify() rejects a non-PE tool even with no pin (identity gate)', () => {
    const seven = { id: '7za-cache', source: 'cache', path: '/cache/7zip/7za.exe' }
    const r = discoverTool({ candidates: [seven], probe: () => true, verify: () => 'not-a-PE-image (MZ header absent)' })
    expect(r.chosen).toBeNull()
    expect(r.rejected[0].reason).toMatch(/not-a-PE/)
  })
})

describe('resolveReleaseTools — cache-root resolver, absolute injected path', () => {
  const which = name => (name === 'signtool' ? '/usr/bin/signtool.exe' : null)
  it('resolves the NEWEST cache 7za and returns its ABSOLUTE path to inject', () => {
    const r = resolveReleaseTools({
      localAppData: 'C:/AppData', vendorSigntool: '/vendor/signtool.exe',
      exists: treeExists, hashFile: () => 'd'.repeat(64), isPe: () => true, readdir: fakeReaddir, which
    })
    expect(r.sevenZip.chosen).not.toBeNull()
    expect(r.sevenZip.chosen.path.replace(/\\/g, '/')).toBe(NEW)
    expect(r.sevenZip.chosen.source).toBe('cache')
    expect(r.signtool.chosen.path).toBe('/vendor/signtool.exe')
    expect(r.signtool.chosen.source).toBe('vendor')
  })
  it('a cache 7za that is NOT a PE image is rejected (identity gate), no cache pick', () => {
    const r = resolveReleaseTools({
      localAppData: 'C:/AppData', vendorSigntool: null,
      exists: treeExists, hashFile: () => null, isPe: () => false, readdir: fakeReaddir, which: () => null
    })
    expect(r.sevenZip.chosen).toBeNull()
    expect(r.sevenZip.rejected.some(x => /not-a-PE/.test(x.reason))).toBe(true)
  })
  it('no vendor, no cache → PATH-resolved signtool (absolute) is chosen', () => {
    const r = resolveReleaseTools({
      localAppData: null, vendorSigntool: null,
      exists: p => p === '/usr/bin/signtool.exe', hashFile: () => 'e'.repeat(64), isPe: () => true, readdir: () => [], which
    })
    expect(r.sevenZip.chosen).toBeNull()
    expect(r.signtool.chosen.source).toBe('path')
    expect(r.signtool.chosen.path).toBe('/usr/bin/signtool.exe')
  })
  it('versionProbe rejects an unusable extractor even when it is a PE', () => {
    const r = resolveReleaseTools({
      localAppData: 'C:/AppData', vendorSigntool: null,
      exists: treeExists, hashFile: () => 'd'.repeat(64), isPe: () => true, readdir: fakeReaddir,
      which: () => null, versionProbe: () => ({ ok: false, reason: 'exit-9' })
    })
    expect(r.sevenZip.chosen).toBeNull()
    expect(r.sevenZip.rejected.some(x => /version-check-failed/.test(x.reason))).toBe(true)
  })
  it('nothing anywhere → both null, availability honest (fail closed)', () => {
    const r = resolveReleaseTools({ localAppData: null, vendorSigntool: null, exists: () => false, isPe: () => true, readdir: () => [], which: () => null })
    expect(r.sevenZip.chosen).toBeNull()
    expect(r.signtool.chosen).toBeNull()
  })
})
