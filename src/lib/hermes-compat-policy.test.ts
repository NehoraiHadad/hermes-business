import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { HERMES_COMPAT_RANGE, HERMES_MAX_VERSION_EXCLUSIVE, HERMES_MIN_VERSION } from './hermes/compat'

// hermes-compat.json is the CANONICAL, single source of truth for the Hermes
// compatibility policy. Each layer necessarily embeds its own copy (they run in
// TS bundle, Electron main, a build script, a Python plugin inside the Hermes
// venv, and standalone PowerShell — none can import the others at runtime).
// These tests are what make the JSON authoritative: every embedded copy is
// asserted equal to it, so the policy can never fork silently.
const repoRoot = path.resolve(__dirname, '..', '..')
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8')
const canonical = JSON.parse(read('hermes-compat.json')) as {
  range: string
  minVersion: string
  maxVersionExclusive: string
  verifiedInstalledVersion: string
  pinnedReleases: Array<{ tag: string; version: string }>
}

describe('canonical Hermes compatibility policy is single-sourced', () => {
  it('the renderer compat module matches the canonical manifest', () => {
    expect(HERMES_MIN_VERSION).toBe(canonical.minVersion)
    expect(HERMES_MAX_VERSION_EXCLUSIVE).toBe(canonical.maxVersionExclusive)
    expect(HERMES_COMPAT_RANGE).toBe(canonical.range)
  })

  it('the electron main-process mirror matches the canonical manifest', () => {
    const cjs = read('electron/hermes-compat.cjs')
    expect(cjs).toContain(`const HERMES_MIN_VERSION = '${canonical.minVersion}'`)
    expect(cjs).toContain(`const HERMES_MAX_VERSION_EXCLUSIVE = '${canonical.maxVersionExclusive}'`)
  })

  it('the plugin SDK build-time contract matches the canonical range', () => {
    const contract = read('scripts/plugin-sdk-contract.mjs')
    expect(contract).toContain(`export const HERMES_COMPAT_RANGE = '${canonical.range}'`)
  })

  it('the Python plugin contract stays inside the canonical range', () => {
    const py = read('hermes-plugin/business-whatsapp-policy/contract.py')
    // The plugin pins the exact verified installed version and the minor-series
    // prefix; both must be consistent with the canonical range.
    expect(py).toContain(`SUPPORTED_HERMES_VERSIONS = frozenset({"${canonical.verifiedInstalledVersion}"})`)
    const [maj, min] = canonical.minVersion.split('.')
    expect(py).toContain(`SUPPORTED_VERSION_PREFIXES = ("${maj}.${min}.",)`)
    expect(canonical.verifiedInstalledVersion.startsWith(`${maj}.${min}.`)).toBe(true)
  })

  it('the installer bootstrap range literals match the canonical manifest', () => {
    const bootstrap = read('installer/bootstrap.ps1')
    expect(bootstrap).toContain(`[version]'${canonical.minVersion}'`)
    expect(bootstrap).toContain(`[version]'${canonical.maxVersionExclusive}'`)
  })

  it('the installer pinned release map matches the canonical manifest', () => {
    const release = read('installer/lib/Release.ps1')
    for (const pin of canonical.pinnedReleases) {
      expect(
        release,
        `Release.ps1 Get-DefaultPinnedReleases missing ${pin.tag} -> ${pin.version}`
      ).toContain(`tag = '${pin.tag}'; version = '${pin.version}'`)
    }
  })

  it('every pinned release the installer trusts is itself in range or explicitly older', () => {
    // A pin outside [min,max) is allowed only to let the selector skip it fast
    // offline; at least one pin MUST be compatible or selection can never
    // succeed from the fallback.
    const inRange = canonical.pinnedReleases.filter(
      pin => pin.version >= canonical.minVersion && pin.version < canonical.maxVersionExclusive
    )
    expect(inRange.length).toBeGreaterThan(0)
  })
})
