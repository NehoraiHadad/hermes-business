import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { HERMES_COMPAT_RANGE, HERMES_MAX_VERSION_EXCLUSIVE, HERMES_MIN_VERSION } from './hermes/compat'

// hermes-compat.json is the CANONICAL single source of truth. Each layer (TS bundle,
// Electron main, build script, Python plugin, PowerShell) runs in its own runtime and
// embeds or derives a copy; these tests assert every copy against the JSON so it can never fork.
const repoRoot = path.resolve(__dirname, '..', '..')
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8')
type Canonical = {
  range: string
  minVersion: string
  maxVersionExclusive: string
  verifiedInstalledVersion: string
  pinnedReleases: Array<{ tag: string; version: string }>
}
const canonical = JSON.parse(read('hermes-compat.json')) as Canonical
const [maj, min] = canonical.minVersion.split('.')
const minorFloor = (v: string) => `${v.split('.').slice(0, 2).join('.')}.`

// The canonical policy has five orthogonal dimensions. Every literal mirror embeds only a
// subset, declared explicitly in `dimensions` (replacing the old coarse `bound` flag that
// conflated the bounds), so a drift on one dimension fails closed for exactly the mirrors
// that carry it. Notably the Python plugin embeds only a minor-granularity lower FLOOR and
// the verified pin -- no upper bound/range, so upper-bound drift must never break it.
type Dimension = 'min' | 'max' | 'range' | 'verified' | 'pinned'
type Mirror = { path: string; dimensions: Dimension[]; required: (c: Canonical) => string[] }
const LITERAL_MIRRORS: Mirror[] = [
  {
    path: 'electron/hermes-compat.cjs',
    dimensions: ['min', 'max'],
    required: c => [
      `const HERMES_MIN_VERSION = '${c.minVersion}'`,
      `const HERMES_MAX_VERSION_EXCLUSIVE = '${c.maxVersionExclusive}'`
    ]
  },
  {
    path: 'scripts/plugin-sdk-contract.mjs',
    dimensions: ['range'],
    required: c => [`export const HERMES_COMPAT_RANGE = '${c.range}'`]
  },
  {
    path: 'installer/bootstrap.ps1',
    dimensions: ['min', 'max'],
    required: c => [`[version]'${c.minVersion}'`, `[version]'${c.maxVersionExclusive}'`]
  },
  {
    // Minor-prefix floor (tracks minVersion at minor granularity, so lower drift must
    // cross a minor) + verified pin only; no upper bound, so 'max'/'range' are absent.
    path: 'hermes-plugin/business-whatsapp-policy/contract.py',
    dimensions: ['min', 'verified'],
    required: c => [
      `SUPPORTED_HERMES_VERSIONS = frozenset({"${c.verifiedInstalledVersion}"})`,
      `SUPPORTED_VERSION_PREFIXES = ("${minorFloor(c.minVersion)}",)`
    ]
  },
  {
    path: 'installer/lib/ReleaseSelection.ps1',
    dimensions: ['pinned'],
    required: c => c.pinnedReleases.map(p => `tag = '${p.tag}'; version = '${p.version}'`)
  }
]

const auditMirror = (contents: string, mirror: Mirror, c: Canonical): string[] =>
  mirror.required(c).filter(s => !contents.includes(s)).map(s => `${mirror.path}: missing ${s}`)

// Mirrors that DERIVE the policy (read the source), so drift is impossible; the test only guards they never regress to an embedded literal.
const DERIVED_MIRRORS: Array<{ path: string; derivesFrom: string; forbidden: (c: Canonical) => string[] }> = [
  {
    path: 'scripts/verify-bootstrap.ps1',
    derivesFrom: 'hermes-compat.json',
    forbidden: c => [`[version]'${c.minVersion}'`, `[version]'${c.maxVersionExclusive}'`]
  },
  {
    path: 'src/components/screens/support/SupportUpdatePanel.tsx',
    derivesFrom: "from '../../../lib/hermes/compat'",
    forbidden: c => [`'${c.minVersion}'`, `'${c.maxVersionExclusive}'`, `'${c.range}'`]
  }
]

describe('canonical Hermes compatibility policy is single-sourced', () => {
  it('the renderer compat module matches the canonical manifest (both bounds)', () => {
    expect(HERMES_MIN_VERSION).toBe(canonical.minVersion)
    expect(HERMES_MAX_VERSION_EXCLUSIVE).toBe(canonical.maxVersionExclusive)
    expect(HERMES_COMPAT_RANGE).toBe(canonical.range)
    expect(canonical.range).toBe(`>=${canonical.minVersion} <${canonical.maxVersionExclusive}`)
  })

  it('the Python contract pins a verified version inside the canonical floor', () => {
    expect(canonical.verifiedInstalledVersion.startsWith(`${maj}.${min}.`)).toBe(true)
  })

  it.each(LITERAL_MIRRORS)('embedded mirror $path matches the canonical manifest', mirror => {
    expect(auditMirror(read(mirror.path), mirror, canonical)).toEqual([])
  })

  it.each(DERIVED_MIRRORS)('derived mirror $path reads the source and hardcodes no bound', mirror => {
    const contents = read(mirror.path)
    expect(contents).toContain(mirror.derivesFrom)
    for (const literal of mirror.forbidden(canonical)) {
      expect(contents, `${mirror.path} regressed to hardcoded ${literal}`).not.toContain(literal)
    }
  })

  it('at least one pinned release the installer trusts is itself in range', () => {
    const inRange = canonical.pinnedReleases.filter(
      p => p.version >= canonical.minVersion && p.version < canonical.maxVersionExclusive
    )
    expect(inRange.length).toBeGreaterThan(0)
  })
})

// A drift on one dimension must fail EVERY mirror embedding it and leave every other
// mirror CLEAN. Both directions prove isolation -- widening the upper bound breaks the
// max/range mirrors yet leaves the Python floor untouched (the old test wrongly co-mutated the lower bound to force that Python failure).
describe('drift is caught fail-closed and isolated per dimension', () => {
  const expectIsolatedDrift = (mutated: Canonical, changed: Dimension[]) => {
    for (const mirror of LITERAL_MIRRORS) {
      const embeds = mirror.dimensions.some(d => changed.includes(d))
      const failures = auditMirror(read(mirror.path), mirror, mutated)
      if (embeds) {
        expect(failures.length, `${mirror.path} embeds ${changed} but did not fail closed`).toBeGreaterThan(0)
      } else {
        expect(failures, `${mirror.path} does not embed ${changed} but drifted`).toEqual([])
      }
    }
  }

  it('a widened upper bound fails only max/range mirrors, never the Python floor', () =>
    expectIsolatedDrift(
      { ...canonical, maxVersionExclusive: '0.21.0', range: `>=${canonical.minVersion} <0.21.0` },
      ['max', 'range']
    ))

  it('a shifted lower floor (minor-crossing) fails only min/range mirrors, not verified/pin', () =>
    expectIsolatedDrift(
      { ...canonical, minVersion: '0.18.0', range: `>=0.18.0 <${canonical.maxVersionExclusive}` },
      ['min', 'range']
    ))

  it('a drifted verified version fails only the Python mirror that pins it', () =>
    expectIsolatedDrift({ ...canonical, verifiedInstalledVersion: '0.19.9' }, ['verified']))

  it('a changed pinned-release map fails only the installer mirror', () =>
    expectIsolatedDrift(
      { ...canonical, pinnedReleases: canonical.pinnedReleases.map(p => ({ ...p, version: '0.99.0' })) },
      ['pinned']
    ))
})
