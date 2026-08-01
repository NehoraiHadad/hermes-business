// UNIT CONTRACT HARNESS — NOT the real Hermes loader, and never proof of one.
//
// This is a hand-written Node reproduction of the DOCUMENTED behaviour of the
// Hermes Desktop runtime-plugin pipeline (apps/desktop/src/contrib/
// runtime-loader.ts + sdk/runtime.ts): integrity check -> bare-specifier rewrite
// (@hermes/plugin-sdk / react -> live shim modules) -> module import -> validate
// default HermesPlugin -> register(ctx). It exists ONLY to exercise our plugin's
// contract in fast, offline unit tests. It is a separate implementation that can
// drift from the real loader, so:
//   * it must NEVER be cited as evidence that real Hermes loads the plugin —
//     that is what verify:plugin (real installed source) and the opt-in
//     real-loader E2E (scripts/e2e-real-loader.mjs) are for;
//   * the module transport differs by necessity (the browser loader uses
//     `URL.createObjectURL(Blob)`, unavailable in Node, so shim source is
//     imported via `data:` URLs here).
// The authoritative check that the real loader still behaves this way is
// verify:plugin, which inspects the installed runtime-loader.ts directly.

import { createHash } from 'node:crypto'

// Contribution area ids — verbatim from the installed desktop source
// (app/routes.ts: 'routes' / 'sidebar.nav'; app/command-palette/contrib.ts:
// 'palette'). A plugin that discovers "enabled" must contribute into these.
export const AREAS = Object.freeze({ routes: 'routes', sidebarNav: 'sidebar.nav', palette: 'palette' })

// Matches a static `from '…'`, side-effect `import '…'` or dynamic `import('…')`
// — anchored to import syntax so string/comment occurrences are never touched.
const importSpecifierRe = () => /(from\s*|import\s*\(\s*|import\s+)(['"])([^'"]+)\2/g

/** Rewrite ONLY mapped import specifiers to their shim URLs (runtime-loader.ts). */
export function rewriteSpecifiers(source, map) {
  return source.replace(importSpecifierRe(), (whole, pre, quote, spec) =>
    map[spec] ? `${pre}${quote}${map[spec]}${quote}` : whole
  )
}

/** Bare specifiers the loader can't resolve (not relative/URL, not SDK-mapped). */
export function unsupportedImports(source, map) {
  const bare = new Set()
  for (const m of source.matchAll(importSpecifierRe())) {
    const spec = m[3]
    if (spec && !/^[./]/.test(spec) && !/^[a-z][a-z0-9+.-]*:/i.test(spec) && !map[spec]) bare.add(spec)
  }
  return [...bare]
}

/** Standard SRI `sha256-<base64>` verification, matching the install receipt. */
export async function verifyIntegrity(bytes, integrity) {
  const [algo, expected] = String(integrity).split('-', 2)
  if (algo !== 'sha256' || !expected) return false
  return createHash('sha256').update(bytes).digest('base64') === expected
}

const dataUrl = src => `data:text/javascript;base64,${Buffer.from(src, 'utf8').toString('base64')}`

/** Build a shim module that re-exports a global namespace's live members —
 *  mirroring the documented strategy of sdk/runtime.ts (export names derived
 *  from the namespace so they can't drift), transported as a data: URL instead
 *  of a Blob URL. This is a harness copy, not the shipped code. */
function shimUrl(globalKey, ns) {
  const names = Object.keys(ns).filter(name => name !== 'default' && /^[A-Za-z_$][\w$]*$/.test(name))
  const src =
    `const m = globalThis.${globalKey};\n` +
    `export default m.default ?? m;\n` +
    (names.length ? `export const { ${names.join(', ')} } = m;\n` : '')
  return dataUrl(src)
}

/** Install the SDK + React singletons on globals and return the specifier map. */
export function buildImportMap(sdk, React) {
  globalThis.__HERMES_PLUGIN_SDK__ = sdk
  globalThis.__HERMES_REACT__ = React
  return {
    '@hermes/plugin-sdk': shimUrl('__HERMES_PLUGIN_SDK__', sdk),
    react: shimUrl('__HERMES_REACT__', React)
  }
}

/**
 * Run the harness pipeline over one plugin source. Returns the validated default
 * HermesPlugin export (id + register), or throws where the documented loader
 * contract would (integrity / unsupported import / invalid export). This models
 * the real loader for unit tests; it is NOT the real loader.
 */
export async function loadRuntimePlugin({ source, bytes, integrity, sdk, React }) {
  if (integrity && !(await verifyIntegrity(bytes ?? Buffer.from(source, 'utf8'), integrity))) {
    throw new Error('integrity check failed')
  }
  const map = buildImportMap(sdk, React)
  const unsupported = unsupportedImports(source, map)
  if (unsupported.length) {
    throw new Error(`unsupported import(s): ${unsupported.join(', ')} — only @hermes/plugin-sdk and react are allowed`)
  }
  const mod = await import(dataUrl(rewriteSpecifiers(source, map)))
  const plugin = mod.default
  if (!plugin?.id || typeof plugin.register !== 'function') {
    throw new Error('source has no valid default HermesPlugin export')
  }
  return plugin
}

/** Harness copy of the documented `pluginPathSuffix` behaviour
 *  (apps/desktop/src/hermes.ts): normalize to a leading-slash suffix and reject
 *  any `..` segment so a relative path can't normalize out of the plugin's
 *  namespace into a core route or another plugin's API. The namespace IS the
 *  boundary. verify:plugin checks the real hermes.ts still enforces this. */
export function pluginPathSuffix(path) {
  const raw = String(path == null ? '' : path)
  const suffix = raw.startsWith('/') ? raw : `/${raw}`
  if (suffix.split(/[/?#]/).some(seg => seg === '..')) {
    throw new Error(`pluginRest: path '${raw}' escapes the plugin namespace`)
  }
  return suffix
}

/**
 * A harness PluginContext modelled on contrib/plugin.ts createPluginContext:
 * register / registerMany scope the id to `<pluginId>:<localId>` and stamp
 * `source: 'plugin:<pluginId>'`, and storage is namespaced per plugin. Captured
 * contributions stand in for the inventory the settings "Plugins" page renders.
 *
 * `rest` models the documented `pluginRest`: namespace-locked BY CONSTRUCTION to
 * `/api/plugins/<pluginId>` and rejects `..`. A caller may inject
 * `restFetch({ path, method, body })` (e.g. the live isolated gateway's REST
 * client) to exercise the plugin's own backend door end-to-end; with no fetcher
 * there is no desktop bridge, as in the real renderer where
 * `window.hermesDesktop.api` is required. This is a test double, not the real
 * PluginContext.
 */
export function createCaptureContext(pluginId, { restFetch } = {}) {
  const contributions = []
  const store = new Map()
  const scope = c => ({ ...c, id: `${pluginId}:${c.id}`, source: `plugin:${pluginId}` })
  const register = c => {
    contributions.push(scope(c))
    return () => {}
  }
  const ctx = {
    source: `plugin:${pluginId}`,
    register,
    registerMany: cs => {
      cs.forEach(register)
      return () => {}
    },
    rest: async (path, opts = {}) => {
      const suffix = pluginPathSuffix(path) // throws on namespace escape, before any I/O
      if (typeof restFetch !== 'function') {
        throw new Error('Hermes desktop bridge unavailable')
      }
      return restFetch({ path: `/api/plugins/${pluginId}${suffix}`, method: opts.method, body: opts.body })
    },
    socket: () => () => {},
    storage: {
      get: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
      set: (key, value) => store.set(key, value),
      remove: key => store.delete(key)
    },
    i18n: { register: () => () => {}, t: key => key }
  }
  return { ctx, contributions }
}
