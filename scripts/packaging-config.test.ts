import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import Ajv from 'ajv'
import {
  isUpdateMetadataFile,
  findUpdateMetadata
} from './verify-no-update-metadata.mjs'
import { packagingStages } from './package-win.mjs'

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

describe('two-phase signing order (CRITICAL 2) is pinned in the packaging orchestrator', () => {
  const win = pkg.build.win as Record<string, unknown>
  // The order used to live twice, as substring positions inside two ~400-char
  // package.json one-liners — so only the public channel was ever asserted. It is
  // now one declarative plan (scripts/package-win.mjs), asserted for ALL channels.
  type Channel = 'public' | 'qa' | 'pilot'
  const plan = (channel: Channel) => packagingStages(channel).map(stage => stage.id)
  const at = (channel: Channel, id: string) => plan(channel).indexOf(id)
  const channels: Channel[] = ['public', 'qa', 'pilot']

  it('package.json delegates all three channels to the single orchestrator', () => {
    expect(String(pkg.scripts['package:win'])).toBe('node scripts/package-win.mjs --channel public')
    expect(String(pkg.scripts['package:win:qa'])).toBe('node scripts/package-win.mjs --channel qa')
    expect(String(pkg.scripts['package:win:pilot'])).toBe('node scripts/package-win.mjs --channel pilot')
  })

  it('skips ONLY code signing (signExecutable:false) while keeping native resedit enabled', () => {
    // Root cause of the missing-icon bug: signAndEditExecutable:false disabled electron-builder's
    // native resedit pass (icon + version metadata) wholesale. The fix keeps that pass — which
    // embeds build/icon.ico and derives the Windows-form version — and disables ONLY signing via
    // signExecutable:false. No signing means our explicit phase-2 signer stays the sole signer.
    expect(win.signExecutable).toBe(false)
    // Must NOT reintroduce the wholesale disable, or the icon/metadata regress again.
    expect(win.signAndEditExecutable).toBeUndefined()
  })

  it.each(channels)(
    '[%s] builds `--win dir` → finalize-payload (sign+verify+manifest) → `--prepackaged … --win nsis`',
    channel => {
      const dir = at(channel, 'electron-builder --win dir')
      const sign = at(channel, 'scripts/finalize-payload.mjs')
      const nsis = at(channel, 'electron-builder --prepackaged release/win-unpacked --win nsis')
      expect(dir).toBeGreaterThan(-1)
      expect(sign).toBeGreaterThan(dir)
      expect(nsis).toBeGreaterThan(sign)
    }
  )

  it.each(channels)(
    '[%s] signs the installer AFTER NSIS and runs the exact-artifact capture BEFORE promotion',
    channel => {
      const stages = plan(channel)
      const nsis = at(channel, 'electron-builder --prepackaged release/win-unpacked --win nsis')
      const signInstaller = at(channel, 'scripts/sign-release.mjs')
      const report = at(channel, 'scripts/gen-release-report.mjs')
      const capture = at(channel, 'scripts/e2e-exact-artifact.mjs')
      const finalize = at(channel, 'scripts/finalize-release.mjs')
      expect(signInstaller).toBeGreaterThan(nsis)
      expect(report).toBeGreaterThan(signInstaller)
      expect(capture).toBeGreaterThan(report)
      // Promotion is the LAST action — no fallible verifier after commit.
      expect(finalize).toBeGreaterThan(capture)
      expect(finalize).toBe(stages.length - 1)
      expect(stages.slice(finalize + 1)).toEqual([])
    }
  )

  it.each(channels)('[%s] runs the fail-closed release preflight before anything is built', channel => {
    expect(at(channel, 'npm:verify:release')).toBe(0)
    expect(at(channel, 'scripts/gen-build-attestation.mjs')).toBeGreaterThan(0)
    expect(at(channel, 'scripts/gen-build-attestation.mjs')).toBeLessThan(
      at(channel, 'electron-builder --win dir')
    )
    expect(at(channel, 'scripts/verify-no-update-metadata.mjs')).toBeGreaterThan(
      at(channel, 'electron-builder --prepackaged release/win-unpacked --win nsis')
    )
    expect(at(channel, 'scripts/gen-lock-attest.mjs')).toBeGreaterThan(
      at(channel, 'scripts/verify-no-update-metadata.mjs')
    )
  })

  it('differs between public/qa in EXACTLY the build script and the channel arguments', () => {
    expect(at('public', 'npm:build')).toBe(1)
    expect(at('qa', 'npm:build:qa')).toBe(1)
    expect(plan('public')).not.toContain('npm:build:qa')
    expect(plan('qa')).not.toContain('npm:build')
    // Same stage sequence otherwise.
    expect(plan('qa').filter(id => id !== 'npm:build:qa')).toEqual(plan('public').filter(id => id !== 'npm:build'))
    for (const channel of channels) {
      for (const id of [
        'scripts/finalize-payload.mjs',
        'scripts/sign-release.mjs',
        'scripts/e2e-exact-artifact.mjs',
        'scripts/finalize-release.mjs'
      ]) {
        const stage = packagingStages(channel).find(s => s.id === id)
        expect(stage?.args).toEqual(['--channel', channel])
      }
    }
  })

  it('pilot uses the REAL `build` (never `build:qa`) — identical stage sequence to public', () => {
    // The whole point of the pilot channel (docs/specs/versioning.md §13 stage 5)
    // is that it ships a real, fixtures-stripped renderer. Its plan must be
    // byte-for-byte public's plan with only the --channel argument swapped.
    expect(at('pilot', 'npm:build')).toBe(1)
    expect(plan('pilot')).not.toContain('npm:build:qa')
    // Stage IDs never encode the channel (only stage.args does), so an identical
    // plan for public and pilot is exactly the assertion we want here.
    expect(plan('pilot')).toEqual(plan('public'))
    for (const channel of ['public', 'pilot'] as const) {
      const stages = packagingStages(channel)
      for (const stage of stages) {
        if (Array.isArray(stage.args) && stage.args.includes('--channel')) {
          expect(stage.args).toEqual(['--channel', channel])
        }
      }
    }
  })

  it('rejects an unknown channel instead of packaging something undefined', () => {
    expect(() => packagingStages('prod' as 'public')).toThrow(/unknown channel/)
  })

  it('afterPack does NOT sign (it runs before the final resource edit / NSIS capture)', () => {
    const afterPack = readFileSync(new URL('./after-pack.cjs', import.meta.url), 'utf8')
    expect(/signtool|signPayload|HERMES_WIN_SIGN_CMD/i.test(afterPack)).toBe(false)
  })

  it('afterPack embeds the icon but hands NO version string to rcedit (native pass owns it)', () => {
    // Passing a prerelease like 0.4.0-alpha.2 to rcedit file-version would be a non-numeric hazard;
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
