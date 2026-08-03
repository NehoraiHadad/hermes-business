import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

// shared/ ships hand-written JS (consumed at runtime by React, Electron and the
// Rollup-bundled Hermes Desktop plugin) plus a sibling hand-written .d.ts contract
// (the type React/Electron actually compile against). tsconfig.app.json sets
// allowJs:false, so the .js is NEVER type-checked — TypeScript trusts the .d.ts
// unconditionally and nothing stops the two from drifting apart.
//
// This test closes that gap mechanically: for every shared/<name>.js it imports the
// real module and diffs its runtime export names against what <name>.d.ts declares,
// in BOTH directions:
//   1. every runtime export must be declared in the .d.ts (else consumers see a type
//      error/`any` for something that really exists, or worse, a declared type hides
//      a rename/removal)
//   2. every declared VALUE export (const/function/let/class) must exist at runtime
//      (else consumers get a false compile-time promise for something that was
//      deleted or renamed in the .js). Type-only exports (interface/type) are exempt
//      from this direction since they have no runtime representation at all.

const sharedDir = path.resolve(__dirname, '../../shared')

// Every hand-written JS+.d.ts pair under shared/ — discovered from disk so a new
// module can never ship without parity coverage (a forgotten manual entry here
// would silently exempt it).
const MODULES = readdirSync(sharedDir)
  .filter(f => f.endsWith('.js'))
  .map(f => f.replace(/\.js$/, ''))

interface DeclaredExports {
  /** Names declared via `export (declare)? const|function|let|class NAME` or a grouped `export { NAME }`. */
  valueExports: Set<string>
  /** Names declared via `export (declare)? interface|type NAME` — type-only, no runtime representation. */
  typeExports: Set<string>
}

// Deliberately simple, commented regex parsing (no TS compiler API) — this file is a
// guardrail, not a type checker. It only needs to recognize the declaration shapes
// shared/*.d.ts actually uses.
function parseDeclaredExports(dtsSource: string): DeclaredExports {
  const valueExports = new Set<string>()
  const typeExports = new Set<string>()

  // `export const FOO`, `export function bar(...)`, `export let baz`, `export class Qux`,
  // optionally with `declare` (e.g. `export declare const FOO`).
  const valueDeclRe = /export\s+(?:declare\s+)?(?:const|function|let|class)\s+([A-Za-z_$][\w$]*)/g
  for (let m = valueDeclRe.exec(dtsSource); m; m = valueDeclRe.exec(dtsSource)) {
    valueExports.add(m[1])
  }

  // `export interface Foo { ... }`, `export type Bar = ...` — type-only, never present
  // at runtime, so they must NOT be required to exist as a runtime export.
  const typeDeclRe = /export\s+(?:declare\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)/g
  for (let m = typeDeclRe.exec(dtsSource); m; m = typeDeclRe.exec(dtsSource)) {
    typeExports.add(m[1])
  }

  // Grouped re-export form `export { A, B as C }` — none of shared/*.d.ts currently use
  // this, but handle it defensively: each named binding counts as a value export unless
  // it was already recognized above as a type (`export type { X }` is not used here).
  const groupRe = /export\s*\{([^}]*)\}/g
  for (let m = groupRe.exec(dtsSource); m; m = groupRe.exec(dtsSource)) {
    for (const part of m[1].split(',')) {
      const exportedName = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (exportedName && !typeExports.has(exportedName)) valueExports.add(exportedName)
    }
  }

  return { valueExports, typeExports }
}

describe('shared/*.js runtime exports match shared/*.d.ts declarations', () => {
  for (const name of MODULES) {
    it(`${name}.d.ts declares exactly the values ${name}.js exports at runtime`, async () => {
      const jsPath = path.join(sharedDir, `${name}.js`)
      const dtsPath = path.join(sharedDir, `${name}.d.ts`)

      const runtimeModule: Record<string, unknown> = await import(pathToFileURL(jsPath).href)
      const runtimeExportNames = Object.keys(runtimeModule)

      const dtsSource = readFileSync(dtsPath, 'utf8')
      const { valueExports } = parseDeclaredExports(dtsSource)

      // Direction 1: nothing the .js actually exports is missing from the .d.ts.
      const undeclared = runtimeExportNames.filter(exportName => !valueExports.has(exportName))
      expect(undeclared, `${name}.js exports not declared in ${name}.d.ts: ${undeclared.join(', ')}`).toEqual([])

      // Direction 2: nothing the .d.ts promises as a value is missing at runtime
      // (type-only interface/type exports are exempt — see parseDeclaredExports).
      const phantom = [...valueExports].filter(declaredName => !runtimeExportNames.includes(declaredName))
      expect(phantom, `${name}.d.ts declares values missing from ${name}.js: ${phantom.join(', ')}`).toEqual([])
    })
  }
})

// Regression guard proving the parser above actually catches drift, independent of
// the real shared/ files (which are expected to pass and therefore can't demonstrate
// a failure on their own).
describe('parseDeclaredExports (parity-test parser self-check)', () => {
  it('flags a runtime export the .d.ts forgot to declare', () => {
    const dts = `export const FOO: string\nexport function bar(): void`
    const { valueExports } = parseDeclaredExports(dts)
    const runtimeExportNames = ['FOO', 'bar', 'baz'] // "baz" simulates a real export missing from the .d.ts
    const undeclared = runtimeExportNames.filter(exportName => !valueExports.has(exportName))
    expect(undeclared).toEqual(['baz'])
  })

  it('flags a declared value export that no longer exists at runtime', () => {
    const dts = `export const FOO: string\nexport function removedLater(): void`
    const { valueExports } = parseDeclaredExports(dts)
    const runtimeExportNames = ['FOO'] // "removedLater" simulates a .js export that was deleted/renamed
    const phantom = [...valueExports].filter(declaredName => !runtimeExportNames.includes(declaredName))
    expect(phantom).toEqual(['removedLater'])
  })

  it('exempts type-only interface/type declarations from the runtime-must-exist direction', () => {
    const dts = `export interface Foo {\n  a: string\n}\nexport type Bar = string\nexport const REAL: number`
    const { valueExports, typeExports } = parseDeclaredExports(dts)
    expect(typeExports.has('Foo')).toBe(true)
    expect(typeExports.has('Bar')).toBe(true)
    expect(valueExports.has('Foo')).toBe(false)
    expect(valueExports.has('Bar')).toBe(false)
    expect(valueExports.has('REAL')).toBe(true)
  })

  it('recognizes a grouped `export { A, B as C }` re-export as a value export', () => {
    const dts = `const A = 1\nfunction b() {}\nexport { A, b as C }`
    const { valueExports } = parseDeclaredExports(dts)
    expect(valueExports.has('A')).toBe(true)
    expect(valueExports.has('C')).toBe(true)
  })
})
