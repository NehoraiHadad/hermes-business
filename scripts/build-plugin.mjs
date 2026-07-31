// Deterministic builder for the shipped Hermes Desktop plugin.
//
// Hermes Desktop loads exactly one self-contained plugin.js that may import only
// 'react' and '@hermes/plugin-sdk'. We author the shell as small ES modules under
// hermes-plugin/business-shell/src and bundle them here with Rollup, keeping those
// two packages external. The output is byte-for-byte deterministic (no timestamps)
// so `--check` can guarantee the committed artifact is never stale.
//
// Usage:
//   node scripts/build-plugin.mjs            # write hermes-plugin/business-shell/plugin.js
//   node scripts/build-plugin.mjs --check    # fail if the committed artifact is stale
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rollup } from 'rollup'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const entry = join(root, 'hermes-plugin', 'business-shell', 'src', 'index.js')
const outputFile = join(root, 'hermes-plugin', 'business-shell', 'plugin.js')

const HEADER = [
  '// GENERATED FILE — do not edit by hand.',
  '// Source: hermes-plugin/business-shell/src/*  ·  Builder: scripts/build-plugin.mjs',
  '// Run `npm run build:plugin` after changing the src modules. Verified by',
  '// `npm run verify:plugin` (stale-artifact check) and src/lib/plugin-source.test.ts.',
  '// Hermes Desktop loads this single file and compiles it without JSX, so every',
  "// element is built with React.createElement and only 'react' and",
  "// '@hermes/plugin-sdk' may be imported.",
  ''
].join('\n')

async function buildSource() {
  const bundle = await rollup({
    input: entry,
    external: ['react', '@hermes/plugin-sdk'],
    // Preserve author-written declarations verbatim; the contract test relies on
    // helper functions staying at top level, and we never want reordering surprises.
    treeshake: false,
    onwarn(warning, warn) {
      if (warning.code === 'CIRCULAR_DEPENDENCY') return
      warn(warning)
    }
  })
  const { output } = await bundle.generate({
    format: 'es',
    // Rollup merges same-source imports into one statement each; strip its trailing
    // semicolons on the two external imports so the shipped file matches the exact
    // `import ... from 'react'` / `'@hermes/plugin-sdk'` header the loader and the
    // contract test expect (they slice those lines off before evaluating).
    generatedCode: { constBindings: true },
    compact: false
  })
  await bundle.close()
  const chunk = output.find(item => item.type === 'chunk')
  let code = chunk.code
  code = code.replace(/(from '(?:react|@hermes\/plugin-sdk)')\s*;/g, '$1')
  code = normalizeDefaultExport(code)
  return `${HEADER}${code.replace(/^﻿/, '')}`
}

// Rollup rewrites `export default { ... }` on an entry into a hoisted binding plus
// `export { x as default }`. The Hermes loader and the contract test expect the
// literal `export default {`, so fold that binding back into a direct default
// export. Deterministic: single entry, treeshake off, so there is exactly one.
function normalizeDefaultExport(code) {
  const match = code.match(/\n?export\s*\{\s*([A-Za-z0-9_$]+)\s+as\s+default\s*\};?\s*$/)
  if (!match) return code
  const name = match[1]
  const withoutFooter = code.slice(0, match.index).replace(/\s*$/, '\n')
  return withoutFooter.replace(new RegExp(`(^|\\n)(?:const|let|var)\\s+${name}\\s*=\\s*`), '$1export default ')
}

const built = await buildSource()

if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = await readFile(outputFile, 'utf8')
  } catch {
    current = ''
  }
  if (current !== built) {
    console.error(
      'Shipped plugin.js is stale or missing. Run `npm run build:plugin` and commit hermes-plugin/business-shell/plugin.js.'
    )
    process.exit(1)
  }
  console.log('Shipped plugin.js is up to date with hermes-plugin/business-shell/src.')
} else {
  await writeFile(outputFile, built, 'utf8')
  console.log(`Bundled Hermes Desktop plugin -> ${outputFile}`)
}
