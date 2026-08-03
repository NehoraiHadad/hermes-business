import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Lockstep guard for the DOM test convention (docs/specs/component-tests.md
// §3.1/§3.4/§7.2). There is no vitest environmentMatchGlobs/test.projects
// switch (see §3.1 for why both were rejected) — instead every DOM test opts
// into jsdom with a per-file docblock, and this file is the enforcement that
// keeps that opt-in from silently rotting. Runs in the default `node`
// environment, in the same style as electron/constants-lockstep.test.ts.

const repoRoot = path.resolve(__dirname, '..', '..')

const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'release',
  '.claude',
  'promo-video',
  'coverage',
  '.vite',
  '.vitest'
])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
    } else {
      out.push(full)
    }
  }
  return out
}

const allFiles = walk(repoRoot)
const toPosix = (p: string) => p.split(path.sep).join('/')
const relFiles = allFiles.map(f => toPosix(path.relative(repoRoot, f)))

const testTsxFiles = relFiles.filter(f => f.endsWith('.test.tsx'))

// ---------------------------------------------------------------------------
// Rule 1: every src/**/*.test.tsx starts with the jsdom environment docblock
// pragma (single-line `//` or a `/** ... */` block form) on the FIRST LINE.
//
// The pragma name below is built from parts rather than written as one
// literal string: Vitest's own docblock scanner matches this exact pragma
// ANYWHERE in a file's raw source (not just line 1 — verified empirically),
// so spelling it out directly in this file's comments/strings would flip
// THIS node-environment file into jsdom the moment the substring appears,
// which is precisely what the rule-6 canary below exists to catch.
// ---------------------------------------------------------------------------
const ENV_PRAGMA_TAG = ['@', 'vitest-environment'].join('')
const JSDOM_DOCBLOCK = new RegExp(`${ENV_PRAGMA_TAG}\\s+jsdom`)

function firstLineDocblock(content: string): string {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? ''
  const trimmed = firstLine.trimStart()
  if (trimmed.startsWith('/*')) {
    // Block comment possibly spanning multiple lines — read until the close.
    const lines = content.split(/\r?\n/)
    let block = ''
    for (const line of lines) {
      block += line + '\n'
      if (line.includes('*/')) break
    }
    return block
  }
  return firstLine
}

// ---------------------------------------------------------------------------
// Rule 2: the first import in each such file is a relative import of
// src/test/setup-dom.
// ---------------------------------------------------------------------------
const IMPORT_LINE = /^\s*import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/

function firstImportSpecifier(content: string): string | null {
  for (const line of content.split(/\r?\n/)) {
    const match = IMPORT_LINE.exec(line)
    if (match) return match[1]
  }
  return null
}

const setupDomAbs = path.join(repoRoot, 'src', 'test', 'setup-dom')

function resolvesToSetupDom(fileAbs: string, specifier: string): boolean {
  if (!specifier.startsWith('.')) return false
  const resolved = path.resolve(path.dirname(fileAbs), specifier).replace(/\.(ts|tsx|js|jsx)$/, '')
  return resolved === setupDomAbs
}

describe('src/**/*.test.tsx files follow the jsdom docblock + setup-dom convention', () => {
  it('at least the infra exemplars exist so this suite is not vacuous', () => {
    expect(testTsxFiles.length).toBeGreaterThan(0)
  })

  it.each(testTsxFiles)('%s: first line opts into jsdom', rel => {
    const content = fs.readFileSync(path.join(repoRoot, rel), 'utf8')
    expect(JSDOM_DOCBLOCK.test(firstLineDocblock(content))).toBe(true)
  })

  it.each(testTsxFiles)('%s: first import is a relative import of src/test/setup-dom', rel => {
    const fileAbs = path.join(repoRoot, rel)
    const content = fs.readFileSync(fileAbs, 'utf8')
    const specifier = firstImportSpecifier(content)
    expect(specifier).not.toBeNull()
    expect(resolvesToSetupDom(fileAbs, specifier as string)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Rule 3: no *.test.tsx file lives outside src/.
// ---------------------------------------------------------------------------
describe('*.test.tsx files only live under src/', () => {
  it('every *.test.tsx path starts with src/', () => {
    const offenders = testTsxFiles.filter(f => !f.startsWith('src/'))
    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Rule 4: no file under electron/ or scripts/ opts into jsdom — those trees
// must stay on the default node environment.
// ---------------------------------------------------------------------------
describe('electron/ and scripts/ never opt into jsdom', () => {
  const candidates = relFiles.filter(f => f.startsWith('electron/') || f.startsWith('scripts/'))

  it('none of them contain the jsdom environment docblock pragma', () => {
    const offenders = candidates.filter(f => {
      const content = fs.readFileSync(path.join(repoRoot, f), 'utf8')
      return JSDOM_DOCBLOCK.test(content)
    })
    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Rule 5: nothing outside *.test.tsx / src/test/** imports from src/test/ —
// protects the shipping bundle from ever pulling in test-only infra.
// ---------------------------------------------------------------------------
const IMPORT_SPECIFIERS = /(?:import|export)[^'"\n]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm

function allImportSpecifiers(content: string): string[] {
  const specs: string[] = []
  let match: RegExpExecArray | null
  IMPORT_SPECIFIERS.lastIndex = 0
  while ((match = IMPORT_SPECIFIERS.exec(content))) {
    const spec = match[1] ?? match[2] ?? match[3]
    if (spec) specs.push(spec)
  }
  return specs
}

const srcTestDirAbs = path.join(repoRoot, 'src', 'test')

describe('only *.test.tsx / src/test/** files import from src/test/', () => {
  const sourceFiles = relFiles.filter(
    f => (f.endsWith('.ts') || f.endsWith('.tsx')) && f.startsWith('src/')
  )
  const isAllowedToImportTestInfra = (rel: string) => rel.endsWith('.test.tsx') || rel.startsWith('src/test/')

  it('no other src/**/*.{ts,tsx} module imports from src/test/', () => {
    const offenders: string[] = []
    for (const rel of sourceFiles) {
      if (isAllowedToImportTestInfra(rel)) continue
      const fileAbs = path.join(repoRoot, rel)
      const content = fs.readFileSync(fileAbs, 'utf8')
      for (const specifier of allImportSpecifiers(content)) {
        if (!specifier.startsWith('.')) continue
        const resolved = path.resolve(path.dirname(fileAbs), specifier)
        if (resolved === srcTestDirAbs || resolved.startsWith(srcTestDirAbs + path.sep)) {
          offenders.push(`${rel} -> ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Rule 6: environment canary — this file itself proves the default vitest
// environment is still `node` (no global jsdom leakage from anywhere else).
// ---------------------------------------------------------------------------
describe('environment canary', () => {
  it('runs in node — document is not defined here', () => {
    expect(typeof document).toBe('undefined')
  })
})
