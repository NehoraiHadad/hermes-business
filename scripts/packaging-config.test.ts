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

  it('disables electron-builder self edit/sign so afterPack rcedit is the final PE mutation', () => {
    // With signAndEditExecutable:false electron-builder does NOT re-edit or sign the
    // exe after afterPack, so our phase-2 signer is the last thing to touch PE bytes.
    expect(win.signAndEditExecutable).toBe(false)
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
