import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CONTRACT_FILES,
  DISCOVERY,
  checkRequirements,
  extractPluginRequirements,
  versionInRange
} from './hermes-desktop-contract.mjs'

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = rel => readFileSync(path.join(repoRoot, rel), 'utf8')
const pluginSource = read('hermes-plugin/business-shell/plugin.js')
const snapshot = JSON.parse(read('scripts/hermes-desktop-contract.json'))

describe('extractPluginRequirements', () => {
  const req = extractPluginRequirements(pluginSource)

  it('derives SDK symbols, host doors, ctx methods and areas from plugin.js', () => {
    expect(req.sdkSymbols).toContain('host')
    expect(req.sdkSymbols).toContain('ROUTES_AREA')
    expect(req.hostMembers).toContain('request')
    expect(req.ctxMethods).toEqual(expect.arrayContaining(['registerMany', 'rest', 'storage']))
    expect(req.areas).toEqual(['PALETTE_AREA', 'ROUTES_AREA', 'SIDEBAR_NAV_AREA'])
  })

  it('parses a minimal source without leaking string matches', () => {
    const req2 = extractPluginRequirements("import { host } from '@hermes/plugin-sdk'\nhost.request()\nctx.rest()\n")
    expect(req2.sdkSymbols).toEqual(['host'])
    expect(req2.hostMembers).toEqual(['request'])
    expect(req2.ctxMethods).toEqual(['rest'])
    expect(req2.areas).toEqual([])
  })
})

describe('versionInRange', () => {
  it('accepts inside the half-open range and rejects the boundaries/outside', () => {
    expect(versionInRange('0.19.1', '>=0.19.0 <0.20.0')).toBe(true)
    expect(versionInRange('0.19.0', '>=0.19.0 <0.20.0')).toBe(true)
    expect(versionInRange('0.20.0', '>=0.19.0 <0.20.0')).toBe(false)
    expect(versionInRange('0.18.9', '>=0.19.0 <0.20.0')).toBe(false)
    expect(versionInRange(null, '>=0.19.0 <0.20.0')).toBe(false)
  })
})

describe('checkRequirements', () => {
  const req = extractPluginRequirements(pluginSource)

  it('passes when sources expose every required token', () => {
    const sources = {
      sdkIndex: `export const host = {}; ${req.sdkSymbols.join(' ')} ${req.hostMembers.join(' ')} ${req.areas.join(' ')}`,
      pluginContract: `createPluginContext ${req.ctxMethods.join(' ')}`,
      runtimeLoader: 'desktop-plugins plugin.js loadRuntimePlugin sha256 createPluginContext',
      sdkRuntime: 'sdkImportMap'
    }
    expect(checkRequirements(req, sources)).toEqual([])
  })

  it('fails closed on a missing source file', () => {
    const failures = checkRequirements(req, { sdkIndex: null, pluginContract: '', runtimeLoader: '', sdkRuntime: '' })
    expect(failures.some(f => f.includes('missing or unreadable'))).toBe(true)
  })

  it('reports the specific absent symbol', () => {
    const sources = { sdkIndex: 'nothing here', pluginContract: '', runtimeLoader: '', sdkRuntime: '' }
    expect(checkRequirements(req, sources).some(f => f.includes('does not expose host'))).toBe(true)
  })
})

describe('checked-in snapshot stays in sync with plugin.js', () => {
  const req = extractPluginRequirements(pluginSource)

  it('covers every live requirement (regenerate scripts/hermes-desktop-contract.json otherwise)', () => {
    for (const kind of ['sdkSymbols', 'hostMembers', 'ctxMethods', 'areas']) {
      const pinned = new Set(snapshot.requirements[kind])
      for (const value of req[kind]) expect(pinned.has(value), `${kind}:${value}`).toBe(true)
    }
  })

  it('pins the four contract files and the discovery invariants', () => {
    for (const rel of Object.values(CONTRACT_FILES)) expect(snapshot.sourceFiles[rel]).toBeTruthy()
    expect(snapshot.discovery).toEqual(DISCOVERY)
    expect(snapshot.generatedFrom.mechanism).toBe('installed-hermes-desktop-source')
  })
})
