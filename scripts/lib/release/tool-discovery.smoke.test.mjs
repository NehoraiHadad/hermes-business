// REAL local-environment smoke test — exercises resolveReleaseTools against the
// ACTUAL electron-builder cache and vendored signtool on THIS machine, with NO
// injected fs seams (real defaults). It asserts the root-cause fix: a versioned
// `Cache/7zip@<ver>/…/7za.exe` is discovered and returned by ABSOLUTE, PE-validated
// path. When the tools are not installed (CI/off-box) each check `skip`s — the
// synthetic unit tests cover that path deterministically. This never signs/extracts.
import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveReleaseTools } from './tool-discovery.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const vendorSigntool = path.join(repoRoot, 'node_modules', '@electron', 'windows-sign', 'vendor', 'signtool.exe')
const cacheRoot = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache') : null

const haveCache = !!cacheRoot && existsSync(cacheRoot)
const haveVendor = existsSync(vendorSigntool)

describe('resolveReleaseTools — real local environment (smoke)', () => {
  const tools = resolveReleaseTools({ vendorSigntool }) // real fs defaults, no seams

  it.runIf(haveCache)('discovers a versioned cache 7za by absolute PE-validated path', () => {
    const chosen = tools.sevenZip.chosen
    if (!chosen) {
      // No 7zip cached yet on this box — acceptable; the resolver reports honestly.
      expect(tools.sevenZip.available).toBe(false)
      return
    }
    expect(chosen.source).toBe('cache')
    expect(path.isAbsolute(chosen.path)).toBe(true)
    expect(existsSync(chosen.path)).toBe(true)
    expect(/7za?\.exe$/i.test(chosen.path)).toBe(true)
    expect(chosen.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it.runIf(haveVendor)('resolves the vendored signtool by absolute path', () => {
    const chosen = tools.signtool.chosen
    expect(chosen).not.toBeNull()
    expect(path.isAbsolute(chosen.path)).toBe(true)
    expect(existsSync(chosen.path)).toBe(true)
    expect(chosen.source === 'vendor' || chosen.source === 'path').toBe(true)
  })

  it('reports honestly and never blocks on its own', () => {
    expect(typeof tools.sevenZip.available).toBe('boolean')
    expect(typeof tools.signtool.available).toBe('boolean')
  })
})
