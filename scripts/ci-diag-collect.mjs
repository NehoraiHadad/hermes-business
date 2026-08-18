// TEMPORARY CI DIAGNOSTIC (2026-08-18) — bisects the runner-only vitest
// collection failure of scripts/packaging-config.test.ts. Generates surgical
// variants of the file and runs each in its own vitest process:
//   v1-verbatim : byte-identical copy under another name  → rules the NAME in/out
//   v2-ascii    : every non-ASCII char replaced with 'X'  → rules UNICODE in/out
//                 (runtime assertions may fail; only COLLECTION matters here)
//   v3-nourl    : `new URL(` calls routed through a helper, defeating vite's
//                 STATIC `new URL(..., import.meta.url)` asset detection
//                 → rules the ASSET-REWRITE path in/out
// Delete this file (and its workflow step) once the root cause is fixed.
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(path.join(root, 'scripts', 'packaging-config.test.ts'), 'utf8')

const variants = {
  'zzdiag-v1-verbatim.test.ts': source,
  'zzdiag-v2-ascii.test.ts': source.replace(/[^\x00-\x7F]/g, 'X'),
  'zzdiag-v3-nourl.test.ts':
    'const __diagUrl = (u: string, b: string) => new URL(u, b)\n' +
    source.replaceAll('new URL(', '__diagUrl(')
}

let summary = []
for (const [name, content] of Object.entries(variants)) {
  const file = path.join(root, 'scripts', name)
  writeFileSync(file, content)
  const r = spawnSync('npx', ['vitest', 'run', `scripts/${name}`], {
    cwd: root, shell: true, encoding: 'utf8', timeout: 120_000
  })
  const out = `${r.stdout || ''}\n${r.stderr || ''}`
  const collected = !/Invalid or unexpected token/.test(out)
  const passed = /Test Files\s+1 passed/.test(out)
  summary.push({ name, collected, passed })
  console.log(`\n===== ${name}: collected=${collected} passed=${passed}`)
  console.log(out.split('\n').filter(l => /FAIL|SyntaxError|Test Files|Tests {2}/.test(l)).join('\n'))
  rmSync(file, { force: true })
}
console.log('\nSUMMARY', JSON.stringify(summary, null, 2))
