// Real-source contract for the Hermes Desktop plugin surface the business-shell
// plugin depends on. This is the SINGLE place that knows (a) where the official
// Desktop plugin source lives inside an installed Hermes and (b) how to derive,
// from our own plugin.js, exactly which SDK symbols, PluginContext methods,
// contribution areas and loader/discovery facts must exist in that source.
//
// It is deliberately import-only helpers with no I/O side effects at load, so
// both the generator (scripts/gen-hermes-contract.mjs) and the verifier
// (scripts/verify-plugin.mjs) share one truth. NOTHING here reproduces the
// loader; it only INSPECTS the real installed source (or a snapshot generated
// from it). The unit harness under scripts/lib/probes/hermes/ is a separate,
// clearly-labelled fast-test artifact and is never consulted as proof of load.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

export const SCHEME_VERSION = 1
export const REPOSITORY = 'NousResearch/hermes-agent'

// The four git-tracked Desktop source files the plugin's runtime behaviour rests
// on, relative to the installed Hermes checkout root (<hermesHome>/hermes-agent).
export const CONTRACT_FILES = Object.freeze({
  sdkIndex: 'apps/desktop/src/sdk/index.ts',
  sdkRuntime: 'apps/desktop/src/sdk/runtime.ts',
  runtimeLoader: 'apps/desktop/src/contrib/runtime-loader.ts',
  pluginContract: 'apps/desktop/src/contrib/plugin.ts'
})

// Discovery / loader invariants the plugin relies on, asserted against the real
// runtime-loader + runtime source. Values are the literal tokens present there.
export const DISCOVERY = Object.freeze({
  diskDoorSegment: 'desktop-plugins',
  pluginFile: 'plugin.js',
  restNamespacePrefix: '/api/plugins/',
  integrityAlgo: 'sha256',
  importMapFactory: 'sdkImportMap',
  loaderEntry: 'loadRuntimePlugin',
  contextFactory: 'createPluginContext'
})

/** Absolute path to the installed Hermes checkout root for a given hermesHome. */
export function hermesAgentRoot(hermesHome) {
  return path.join(hermesHome, 'hermes-agent')
}

/** Absolute path to one contract file inside an installed Hermes. */
export function contractFilePath(hermesHome, key) {
  return path.join(hermesAgentRoot(hermesHome), CONTRACT_FILES[key])
}

/** Parse the installed package version from hermes-agent/pyproject.toml. */
export function readInstalledVersion(hermesHome) {
  try {
    const toml = readFileSync(path.join(hermesAgentRoot(hermesHome), 'pyproject.toml'), 'utf8')
    return toml.match(/^\s*version\s*=\s*["']([0-9]+\.[0-9]+\.[0-9]+)["']/m)?.[1] || null
  } catch {
    return null
  }
}

/** Minimal `>=a <b` semver-range check (matches the installer/bootstrap gate). */
export function versionInRange(version, range) {
  const bounds = [...String(range).matchAll(/(>=|<)\s*([0-9]+\.[0-9]+\.[0-9]+)/g)]
  const num = v => v.split('.').map(Number)
  const cmp = (a, b) => {
    const [x, y] = [num(a), num(b)]
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
    return 0
  }
  if (!version || bounds.length === 0) return false
  return bounds.every(([, op, bound]) => (op === '>=' ? cmp(version, bound) >= 0 : cmp(version, bound) < 0))
}

const importedSdkSymbols = source =>
  (source.match(/import\s*\{([\s\S]*?)\}\s*from '@hermes\/plugin-sdk'/)?.[1] || '')
    .split(',').map(s => s.trim()).filter(Boolean)

const uniqSorted = values => [...new Set(values)].sort()

/**
 * Derive, straight from OUR plugin.js, the concrete surface it depends on. The
 * verifier then proves every one of these exists in the real installed source,
 * so the plugin can never rely on a symbol/method/area/host door the shipped
 * Hermes does not provide.
 */
export function extractPluginRequirements(pluginSource) {
  return {
    sdkSymbols: uniqSorted(importedSdkSymbols(pluginSource)),
    hostMembers: uniqSorted([...pluginSource.matchAll(/host\.([a-zA-Z]+)/g)].map(m => m[1])),
    ctxMethods: uniqSorted([...pluginSource.matchAll(/ctx\.([a-zA-Z]+)/g)].map(m => m[1])),
    areas: uniqSorted([...pluginSource.matchAll(/\b(ROUTES_AREA|SIDEBAR_NAV_AREA|PALETTE_AREA)\b/g)].map(m => m[1]))
  }
}

/** sha256 hex of a file's bytes (provenance anchor for release drift checks). */
export function fileSha256(absPath) {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex')
}

/**
 * Prove a required surface exists in the real source. Returns a list of failure
 * strings (empty === contract satisfied). `sources` is a map keyed like
 * CONTRACT_FILES to that file's text. Fails when a source is missing/empty.
 */
export function checkRequirements(req, sources) {
  const failures = []
  const need = (key, tokens, whatFor) => {
    const src = sources[key]
    if (!src) {
      failures.push(`installed Hermes source ${CONTRACT_FILES[key]} is missing or unreadable`)
      return
    }
    for (const token of tokens) {
      if (!new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(src)) {
        failures.push(`${CONTRACT_FILES[key]} does not expose ${token} (${whatFor})`)
      }
    }
  }
  // SDK symbols + host doors both resolve through sdk/index.ts.
  need('sdkIndex', req.sdkSymbols, 'imported SDK symbol')
  need('sdkIndex', req.hostMembers, 'host door')
  need('sdkIndex', req.areas, 'contribution area')
  // PluginContext methods are the authoring contract in contrib/plugin.ts.
  need('pluginContract', req.ctxMethods, 'PluginContext method')
  need('pluginContract', [DISCOVERY.contextFactory], 'context factory')
  // Loader + discovery invariants.
  need('runtimeLoader', [DISCOVERY.diskDoorSegment, DISCOVERY.pluginFile, DISCOVERY.loaderEntry, DISCOVERY.integrityAlgo, DISCOVERY.contextFactory], 'disk-door loader')
  need('sdkRuntime', [DISCOVERY.importMapFactory], 'SDK import-map shim')
  return failures
}

/** Read all four contract files for a hermesHome into a CONTRACT_FILES-keyed map. */
export function readContractSources(hermesHome) {
  const sources = {}
  for (const key of Object.keys(CONTRACT_FILES)) {
    try {
      sources[key] = readFileSync(contractFilePath(hermesHome, key), 'utf8')
    } catch {
      sources[key] = null
    }
  }
  return sources
}
