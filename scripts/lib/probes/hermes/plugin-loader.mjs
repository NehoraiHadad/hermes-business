// Faithful Node reproduction of the OFFICIAL Hermes Desktop runtime-plugin
// loader pipeline (apps/desktop/src/contrib/runtime-loader.ts +
// apps/desktop/src/sdk/runtime.ts), so this suite discovers the business-shell
// plugin exactly as the shipped renderer does — integrity check -> bare-specifier
// rewrite (@hermes/plugin-sdk / react -> live shim modules) -> module import ->
// validate default HermesPlugin -> register(ctx). The ONLY substitution is the
// module transport: the browser uses `URL.createObjectURL(Blob)`, unavailable in
// Node, so the identical shim source is imported via `data:` URLs. The rewrite,
// integrity, unsupported-import and validation logic are byte-for-byte the same.

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

/** Build a shim module that re-exports a global namespace's live members — the
 *  exact strategy of sdk/runtime.ts (export names derived from the namespace so
 *  they can't drift), transported as a data: URL instead of a Blob URL. */
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
 * Run the full official pipeline over one plugin source. Returns the validated
 * default HermesPlugin export (id + register), or throws exactly where the
 * renderer would (integrity / unsupported import / invalid export).
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

/**
 * A faithful PluginContext (contrib/plugin.ts createPluginContext): register /
 * registerMany scope the id to `<pluginId>:<localId>` and stamp
 * `source: 'plugin:<pluginId>'`, and storage is namespaced per plugin. Captured
 * contributions ARE the inventory the settings "Plugins" page renders.
 */
export function createCaptureContext(pluginId) {
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
    rest: async () => {
      throw new Error('ctx.rest is not part of the business-shell contract')
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
