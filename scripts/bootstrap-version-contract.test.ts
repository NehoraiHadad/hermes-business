import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

describe('thin-bootstrap version contract', () => {
  const pkg = JSON.parse(read('package.json'))
  const build = read('scripts/build-bootstrap.ps1')
  const bootstrap = read('installer/bootstrap.ps1')
  const nsis = read('installer/business-bootstrap.nsi')
  const manifest = read('installer/lib/CompanionManifest.ps1')
  const semver = read('installer/lib/SemVer.ps1')

  it('takes the product version from package.json at build time', () => {
    expect(build).toContain("Join-Path $root 'package.json'")
    expect(build).toContain('version = $productVersion')
    expect(build).toContain('/DPRODUCT_VERSION=$productVersion')
    expect(nsis).toContain('OutFile "..\\release\\Hermes-Business-Web-Setup-${PRODUCT_VERSION}.exe"')
  })

  it('passes the exact build version into the packaged bootstrap', () => {
    expect(nsis).toContain('-BootstrapVersion "${PRODUCT_VERSION}"')
    expect(bootstrap).toContain("$BootstrapVersion = [string](Get-Content -Raw")
  })

  it('accepts semver prereleases through one shared parser and derived range', () => {
    expect(nsis).toContain('File "lib\\SemVer.ps1"')
    expect(manifest).toContain('ConvertTo-BusinessSemVer $rawVersion')
    expect(manifest).toContain('Get-CompanionVersionRange -BootstrapVersion $BootstrapVersion')
    expect(semver).toContain('Compare-BusinessSemVer')
  })

  it('contains no obsolete product-version pin in the runtime path', () => {
    for (const source of [build, bootstrap, nsis, manifest]) {
      expect(source).not.toContain("'0.3.3'")
      expect(source).not.toContain('"0.3.3"')
    }
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  })
})
