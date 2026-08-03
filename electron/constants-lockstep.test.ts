import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Task 1.4 (docs/improvement-plan.md): pin constants that are duplicated
// across module boundaries (electron/*.cjs main-process code vs scripts/*.mjs
// harness code vs src/lib/*.ts renderer code) so a silent edit to only one
// copy fails a test instead of drifting unnoticed. This file adds NO source
// changes — it only asserts the copies currently agree. If a claim below no
// longer holds (a copy was removed/consolidated), the assertion is skipped
// with a comment explaining what changed, per the task brief.

const repoRoot = path.resolve(__dirname, '..')
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8')

// ---------------------------------------------------------------------------
// 1) QA sentinel value 'isolated-temp-home'
//    electron/qa-runtime-policy.cjs (SENTINEL_VALUE, exported)
//    scripts/lib/isolated-runtime.mjs (QA_SENTINEL_VALUE, exported)
//    scripts/lib/e2e-safety.mjs (QA_SENTINEL, exported)
// ---------------------------------------------------------------------------
import { SENTINEL_VALUE as POLICY_SENTINEL_VALUE, PORT_MIN as POLICY_PORT_MIN, PORT_MAX as POLICY_PORT_MAX } from './qa-runtime-policy.cjs'
import { QA_SENTINEL_VALUE as ISOLATED_RUNTIME_SENTINEL_VALUE } from '../scripts/lib/isolated-runtime.mjs'
import { QA_SENTINEL as E2E_SAFETY_SENTINEL } from '../scripts/lib/e2e-safety.mjs'

describe('QA sentinel value stays in lockstep across all three copies', () => {
  it('electron/qa-runtime-policy.cjs, scripts/lib/isolated-runtime.mjs, scripts/lib/e2e-safety.mjs all agree', () => {
    expect(POLICY_SENTINEL_VALUE).toBe('isolated-temp-home')
    expect(ISOLATED_RUNTIME_SENTINEL_VALUE).toBe(POLICY_SENTINEL_VALUE)
    expect(E2E_SAFETY_SENTINEL).toBe(POLICY_SENTINEL_VALUE)
  })
})

// ---------------------------------------------------------------------------
// 2) QA port range 41000-60000
//    electron/qa-runtime-policy.cjs (PORT_MIN/PORT_MAX, exported)
//    scripts/lib/isolated-runtime.mjs (QA_PORT_MIN/QA_PORT_MAX, NOT exported —
//    module-private consts used only inside chooseIsolatedPort/isolatedLaunchEnv).
//    Extracted from source text with a tight regex since there is no export to
//    import; this is intentionally brittle so a rename/reformat is caught too.
// ---------------------------------------------------------------------------
function extractConst(source: string, name: string): number {
  const match = new RegExp(`const ${name} = (\\d+)`).exec(source)
  if (!match) throw new Error(`could not find "const ${name} = <number>" in source`)
  return Number(match[1])
}

describe('QA port range stays in lockstep', () => {
  const isolatedRuntimeSource = read('scripts/lib/isolated-runtime.mjs')
  const harnessPortMin = extractConst(isolatedRuntimeSource, 'QA_PORT_MIN')
  const harnessPortMax = extractConst(isolatedRuntimeSource, 'QA_PORT_MAX')

  it('electron/qa-runtime-policy.cjs matches the exported PORT_MIN/PORT_MAX', () => {
    expect(POLICY_PORT_MIN).toBe(41000)
    expect(POLICY_PORT_MAX).toBe(60000)
  })

  it('scripts/lib/isolated-runtime.mjs (private consts, text-extracted) matches the policy range', () => {
    expect(harnessPortMin).toBe(POLICY_PORT_MIN)
    expect(harnessPortMax).toBe(POLICY_PORT_MAX)
  })

  it('behaviorally: isolatedLaunchEnv accepts the policy boundaries and rejects one step outside them', async () => {
    const { isolatedLaunchEnv } = await import('../scripts/lib/isolated-runtime.mjs')
    expect(() => isolatedLaunchEnv({ home: 'x', port: POLICY_PORT_MIN })).not.toThrow()
    expect(() => isolatedLaunchEnv({ home: 'x', port: POLICY_PORT_MAX })).not.toThrow()
    expect(() => isolatedLaunchEnv({ home: 'x', port: POLICY_PORT_MIN - 1 })).toThrow()
    expect(() => isolatedLaunchEnv({ home: 'x', port: POLICY_PORT_MAX + 1 })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// 3) E2E temp-path sentinel regex
//    electron/runtime-mode.cjs: isTestPath() uses /hermes-(business-e2e|qa-home|e2e-home)/i
//    scripts/lib/environment-path.mjs: isHermesTestPathEntry() uses
//    /(?:hermes-business-e2e|hermes-qa-home|hermes-e2e-home)/i
//    The two patterns are written differently (shared prefix + alternation vs
//    three full alternatives) but are meant to accept/reject the same set of
//    path segments. Testing behaviorally per the task brief rather than
//    comparing regex source, so an equivalent-but-differently-written pattern
//    still passes. electron/runtime-mode.cjs is read-only here (owned by
//    concurrent work elsewhere) — this file only imports/reads it.
// ---------------------------------------------------------------------------
import { isTestPath } from './runtime-mode.cjs'
import { isHermesTestPathEntry } from '../scripts/lib/environment-path.mjs'

describe('E2E temp-path sentinel regex accepts/rejects the same path set in both copies', () => {
  const shouldMatch = [
    'hermes-business-e2e-8f3c2a',
    'hermes-qa-home-1234',
    'hermes-e2e-home-xyz',
    'HERMES-QA-HOME-CAPS', // case-insensitive
    'prefix-hermes-business-e2e-suffix' // unanchored match
  ]
  const shouldNotMatch = [
    'hermes-home', // the live/default home must never be flagged
    'hermes-business', // missing the -e2e suffix
    'hermes-e2ehome', // missing the dash inside e2e-home
    'random-temp-dir',
    'hermes-qa' // partial segment only
  ]

  it.each(shouldMatch)('both flag %s as a test path', segment => {
    const fullPath = path.join(os.tmpdir(), segment)
    expect(isHermesTestPathEntry(fullPath)).toBe(true)
    expect(isTestPath(fullPath, { TEMP: os.tmpdir() })).toBe(true)
  })

  it.each(shouldNotMatch)('both reject %s as a test path', segment => {
    const fullPath = path.join(os.tmpdir(), segment)
    expect(isHermesTestPathEntry(fullPath)).toBe(false)
    expect(isTestPath(fullPath, { TEMP: os.tmpdir() })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 4) Hermes compat range >=0.19.0 <0.20.0
//    electron/hermes-compat.cjs, src/lib/hermes/compat.ts, hermes-compat.json,
//    scripts/plugin-sdk-contract.mjs.
//    src/lib/hermes-compat-policy.test.ts already asserts every mirror (incl.
//    these four) against hermes-compat.json as the canonical source, with
//    isolated-drift meta-tests per dimension — that coverage is NOT duplicated
//    here. This block adds a direct, self-contained four-way check scoped to
//    exactly the modules named in this task, plus a behavioral parity check of
//    isVersionSupported() across the .cjs and .ts copies (which the existing
//    policy test does not do — it only compares embedded literals).
// ---------------------------------------------------------------------------
import {
  HERMES_COMPAT_RANGE as CJS_RANGE,
  HERMES_MIN_VERSION as CJS_MIN,
  HERMES_MAX_VERSION_EXCLUSIVE as CJS_MAX,
  isVersionSupported as cjsIsVersionSupported
} from './hermes-compat.cjs'
import {
  HERMES_COMPAT_RANGE as TS_RANGE,
  HERMES_MIN_VERSION as TS_MIN,
  HERMES_MAX_VERSION_EXCLUSIVE as TS_MAX,
  isVersionSupported as tsIsVersionSupported
} from '../src/lib/hermes/compat'
import { HERMES_COMPAT_RANGE as MJS_RANGE } from '../scripts/plugin-sdk-contract.mjs'

describe('Hermes compat range stays in lockstep across all four copies', () => {
  const canonical = JSON.parse(read('hermes-compat.json')) as {
    range: string
    minVersion: string
    maxVersionExclusive: string
  }

  it('electron/hermes-compat.cjs, src/lib/hermes/compat.ts, hermes-compat.json, scripts/plugin-sdk-contract.mjs all agree on the range', () => {
    expect(CJS_RANGE).toBe(canonical.range)
    expect(TS_RANGE).toBe(canonical.range)
    expect(MJS_RANGE).toBe(canonical.range)
    expect(CJS_MIN).toBe(canonical.minVersion)
    expect(TS_MIN).toBe(canonical.minVersion)
    expect(CJS_MAX).toBe(canonical.maxVersionExclusive)
    expect(TS_MAX).toBe(canonical.maxVersionExclusive)
  })

  it.each(['0.18.9', '0.19.0', '0.19.99', '0.20.0'])(
    'isVersionSupported(%s) agrees between electron/hermes-compat.cjs and src/lib/hermes/compat.ts',
    version => {
      expect(cjsIsVersionSupported(version)).toBe(tsIsVersionSupported(version))
    }
  )

  it('the shared boundary semantics are what both copies actually implement (min inclusive, max exclusive)', () => {
    expect(tsIsVersionSupported('0.18.9')).toBe(false)
    expect(tsIsVersionSupported('0.19.0')).toBe(true)
    expect(tsIsVersionSupported('0.19.99')).toBe(true)
    expect(tsIsVersionSupported('0.20.0')).toBe(false)
    expect(cjsIsVersionSupported('0.18.9')).toBe(false)
    expect(cjsIsVersionSupported('0.19.0')).toBe(true)
    expect(cjsIsVersionSupported('0.19.99')).toBe(true)
    expect(cjsIsVersionSupported('0.20.0')).toBe(false)
  })
})
