import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import Ajv from 'ajv'
import {
  isUpdateMetadataFile,
  findUpdateMetadata
} from './verify-no-update-metadata.mjs'

// Locks the electron-builder packaging contract so it cannot silently regress:
//  1. `build` validates against electron-builder's OWN schema — an unknown
//     property (e.g. the `//publish` JSON "comment" that broke `package:win`)
//     fails here on plain `npm test`, long before a slow packaging run.
//  2. The "no self-update feed" intent is asserted without any build/network:
//     `publish: null` suppresses `latest.yml`, and no electron-updater consumer
//     means no `app-update.yml`. See scripts/verify-no-update-metadata.mjs.
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const scheme = JSON.parse(
  readFileSync(
    new URL('../node_modules/app-builder-lib/scheme.json', import.meta.url),
    'utf8'
  )
)

function commentKeys(value: unknown, path = 'build'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => commentKeys(v, `${path}[${i}]`))
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => {
      const here = k.startsWith('//') ? [`${path}.${k}`] : []
      return [...here, ...commentKeys(v, `${path}.${k}`)]
    })
  }
  return []
}

describe('electron-builder packaging config', () => {
  it('validates against electron-builder’s schema (root forbids unknown props)', () => {
    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate = ajv.compile(scheme)
    const ok = validate(pkg.build)
    // Surface the offending property (e.g. `//publish`) if this ever fails.
    expect(validate.errors ?? [], JSON.stringify(validate.errors, null, 2)).toEqual([])
    expect(ok).toBe(true)
  })

  it('rejects JSON "comment" keys like `//publish` anywhere in build', () => {
    expect(commentKeys(pkg.build)).toEqual([])
    // Same schema rule that already caught it, proven directly.
    expect(scheme.additionalProperties).toBe(false)
  })
})

describe('two-phase signing order (CRITICAL 2) is pinned in the package script', () => {
  const win = pkg.build.win as Record<string, unknown>
  const script = String(pkg.scripts['package:win'])

  it('skips ONLY code signing (signExecutable:false) while keeping native resedit enabled', () => {
    // Root cause of the missing-icon bug: signAndEditExecutable:false disabled electron-builder's
    // native resedit pass (icon + version metadata) wholesale. The fix keeps that pass — which
    // embeds build/icon.ico and derives the Windows-form version — and disables ONLY signing via
    // signExecutable:false. No signing means our explicit phase-2 signer stays the sole signer.
    expect(win.signExecutable).toBe(false)
    // Must NOT reintroduce the wholesale disable, or the icon/metadata regress again.
    expect(win.signAndEditExecutable).toBeUndefined()
  })

  it('builds `--win dir` → finalize-payload (sign+verify+manifest) → `--prepackaged … --win nsis`', () => {
    const dir = script.indexOf('electron-builder --win dir')
    const sign = script.indexOf('finalize-payload.mjs --channel public')
    const nsis = script.indexOf('--prepackaged release/win-unpacked --win nsis')
    expect(dir).toBeGreaterThan(-1)
    expect(sign).toBeGreaterThan(dir)
    expect(nsis).toBeGreaterThan(sign)
  })

  it('signs the installer AFTER NsIS and runs the exact-artifact capture BEFORE promotion', () => {
    const nsis = script.indexOf('--prepackaged release/win-unpacked --win nsis')
    const signInstaller = script.indexOf('sign-release.mjs --channel public')
    const report = script.indexOf('gen-release-report.mjs')
    const capture = script.indexOf('e2e-exact-artifact.mjs --channel public')
    const finalize = script.indexOf('finalize-release.mjs --channel public')
    expect(signInstaller).toBeGreaterThan(nsis)
    expect(report).toBeGreaterThan(signInstaller)
    expect(capture).toBeGreaterThan(report)
    // Promotion is the LAST action — no fallible verifier after commit.
    expect(finalize).toBeGreaterThan(capture)
    expect(script.indexOf('verify:release-contract', finalize)).toBe(-1)
  })

  it('afterPack does NOT sign (it runs before the final resource edit / NSIS capture)', () => {
    const afterPack = readFileSync(new URL('./after-pack.cjs', import.meta.url), 'utf8')
    expect(/signtool|signPayload|HERMES_WIN_SIGN_CMD/i.test(afterPack)).toBe(false)
  })

  it('afterPack embeds the icon but hands NO version string to rcedit (native pass owns it)', () => {
    // Passing the 0.4.0-alpha.1 prerelease to rcedit file-version would be a non-numeric hazard;
    // afterPack embeds icon-only, and electron-builder's native resedit renders the numeric form.
    const afterPack = readFileSync(new URL('./after-pack.cjs', import.meta.url), 'utf8')
    expect(afterPack).toMatch(/rcedit\([^)]*\{\s*icon\s*\}/)
    expect(/file-version|product-version|version-string/i.test(afterPack)).toBe(false)
  })
})

describe('branding + version metadata for native resedit', () => {
  const win = pkg.build.win as Record<string, unknown>

  it('points the native icon pass at a real multi-size .ico', () => {
    expect(win.icon).toBe('build/icon.ico')
    const ico = readFileSync(new URL('../build/icon.ico', import.meta.url))
    // ICONDIR header: reserved=0, type=1 (icon), count>=1.
    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBeGreaterThan(0)
  })

  it('ships a valid semver that electron-builder can render numerically', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
    // getVersionInWeirdWindowsForm() splits on '.' and parseInt()s each part; the prerelease
    // suffix must live on the patch segment so it degrades to a clean 0.4.0.0, never NaN.
    const [major, minor, patch] = pkg.version.split('.')
    expect(Number.isNaN(parseInt(major, 10))).toBe(false)
    expect(Number.isNaN(parseInt(minor, 10))).toBe(false)
    expect(Number.isNaN(parseInt(patch, 10))).toBe(false)
  })

  it('keeps package.json and the lockfile version in lockstep', () => {
    const lock = JSON.parse(
      readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')
    )
    expect(lock.version).toBe(pkg.version)
    expect(lock.packages[''].version).toBe(pkg.version)
  })

  it('exposes an author.name so electron-builder embeds a CompanyName string', () => {
    // companyName is derived from metadata.author.name; a bare string yields no CompanyName,
    // and the native resedit pass would then drop it from the PE version table.
    expect(typeof pkg.author).toBe('object')
    expect(String((pkg.author as { name?: string }).name)).toContain("תכל'ס")
  })

  it('carries no user-facing POC label in shipped product metadata', () => {
    const metadata = JSON.stringify({
      productName: pkg.build.productName,
      shortcutName: pkg.build.nsis?.shortcutName,
      description: pkg.description,
      author: pkg.author
    })
    expect(/poc/i.test(metadata)).toBe(false)
  })
})

describe('no self-update feed is advertised', () => {
  it('sets publish=null so electron-builder emits no latest.yml', () => {
    expect(pkg.build.publish).toBeNull()
  })

  it('declares no electron-updater consumer so no app-update.yml is produced', () => {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    expect(deps['electron-updater']).toBeUndefined()
  })

  it('recognises the update-metadata artifacts the post-build guard blocks', () => {
    expect(isUpdateMetadataFile('latest.yml')).toBe(true)
    expect(isUpdateMetadataFile('latest-x64.yml')).toBe(true)
    expect(isUpdateMetadataFile('app-update.yml')).toBe(true)
    expect(isUpdateMetadataFile('builder-effective-config.yaml')).toBe(false)
    expect(isUpdateMetadataFile('package.json')).toBe(false)
  })

  it('finds no update metadata in the committed tree (no stale feed shipped)', () => {
    // Scans source dirs only; the packaged `release/` output is checked by the
    // post-build guard wired into `package:win`.
    for (const sub of ['electron', 'scripts', 'src', 'build']) {
      expect(findUpdateMetadata(`${repoRoot}/${sub}`)).toEqual([])
    }
  })
})
