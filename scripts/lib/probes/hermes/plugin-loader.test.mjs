import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  AREAS,
  createCaptureContext,
  loadRuntimePlugin,
  rewriteSpecifiers,
  unsupportedImports,
  verifyIntegrity
} from './plugin-loader.mjs'

const MAP = { '@hermes/plugin-sdk': 'data:sdk', react: 'data:react' }

describe('runtime-loader guards (faithful to apps/desktop/src/contrib/runtime-loader.ts)', () => {
  it('rewrites only mapped import specifiers, never string literals', () => {
    const src = "import { host } from '@hermes/plugin-sdk'\nimport React from 'react'\nconst s = 'react'\n"
    const out = rewriteSpecifiers(src, MAP)
    expect(out).toContain("from 'data:sdk'")
    expect(out).toContain("from 'data:react'")
    expect(out).toContain("const s = 'react'") // untouched string literal
  })

  it('flags forbidden bare specifiers but allows sdk + react', () => {
    const ok = "import { host } from '@hermes/plugin-sdk'\nimport React from 'react'\n"
    expect(unsupportedImports(ok, MAP)).toEqual([])
    // Bare (non-scheme, non-relative) specifiers are flagged. `node:fs` matches
    // the URL-scheme rule, so — exactly like the shipped loader — it is skipped
    // by THIS guard (verify-plugin.mjs separately forbids node:/electron/@ imports).
    const bad = "import _ from 'lodash'\nimport x from '@/secret'\nimport fs from 'node:fs'\n"
    expect(unsupportedImports(bad, MAP).sort()).toEqual(['@/secret', 'lodash'])
  })

  it('verifies standard SRI sha256-<base64> and rejects tampering', async () => {
    const bytes = Buffer.from('plugin bytes', 'utf8')
    const integrity = `sha256-${createHash('sha256').update(bytes).digest('base64')}`
    expect(await verifyIntegrity(bytes, integrity)).toBe(true)
    expect(await verifyIntegrity(Buffer.from('tampered'), integrity)).toBe(false)
    expect(await verifyIntegrity(bytes, 'md5-nope')).toBe(false)
  })

  it('exposes the official area ids', () => {
    expect(AREAS).toEqual({ routes: 'routes', sidebarNav: 'sidebar.nav', palette: 'palette' })
  })

  it('loads a minimal plugin and scopes contribution ids like createPluginContext', async () => {
    const source = "export default { id: 'demo', name: 'Demo', register(ctx) { ctx.register({ id: 'page', area: 'routes' }) } }\n"
    const plugin = await loadRuntimePlugin({ source, sdk: {}, React: {} })
    expect(plugin.id).toBe('demo')
    const { ctx, contributions } = createCaptureContext(plugin.id)
    plugin.register(ctx)
    expect(contributions[0]).toMatchObject({ id: 'demo:page', area: 'routes', source: 'plugin:demo' })
  })

  it('rejects a source with no valid default HermesPlugin export', async () => {
    await expect(loadRuntimePlugin({ source: 'export const x = 1\n', sdk: {}, React: {} })).rejects.toThrow(/no valid default/)
  })
})
