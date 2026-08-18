import { readFileSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// git-TRACKED files only: a CI checkout contains exactly these, and untracked
// work-in-progress from a parallel session must not fail this checkout's suite.
// The moment such a file is committed, the guard applies to it everywhere.
function trackedScriptMjs() {
  return execFileSync('git', ['ls-files', '--', 'scripts/*.mjs', 'scripts/**/*.mjs'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
    .map(rel => path.join(root, rel))
}

describe('module hygiene: scripts/**/*.mjs', () => {
  // Every script here is invoked as `node <script>` (package.json scripts,
  // docs, workflows) — a shebang serves nothing on this repo. Worse, any of
  // these modules may be imported as a LIBRARY by a test, and vitest's ssr
  // transform hoists imports ABOVE the original first line: a surviving `#!`
  // lands mid-statement and kills suite collection with a stackless
  // "SyntaxError: Invalid or unexpected token" — but only on some machines
  // (CRLF/LF changes the hoist layout), which made it a CI-only mystery.
  // Root-caused 2026-08-18 on GitHub runners via a raw-error reporter;
  // verify-no-update-metadata.mjs was the carrier. Never reintroduce shebangs.
  it('no tracked .mjs script carries a shebang', () => {
    const files = trackedScriptMjs()
    expect(files.length).toBeGreaterThan(50) // the sweep really ran
    const offenders = files
      .filter(file => readFileSync(file, 'utf8').startsWith('#!'))
      .map(file => path.relative(root, file))
    expect(offenders, 'remove the `#!` line — these are `node <script>` CLIs and library imports, never direct POSIX executables').toEqual([])
  })
})
