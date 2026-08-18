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
  return trackedFiles('scripts/*.mjs', 'scripts/**/*.mjs')
}

function trackedFiles(...patterns) {
  return execFileSync('git', ['ls-files', '--', ...patterns], { cwd: root, encoding: 'utf8' })
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

describe('module hygiene: one reader for the running app version', () => {
  // There were THREE private `defaultGetVersion()` helpers - one each in
  // companion-update.cjs, companion-download.cjs and companion-rollback.cjs -
  // and they had drifted: two threw when Electron was absent, the third
  // swallowed the error and returned null.
  //
  // That is not cosmetic duplication. The running version is the anti-replay
  // anchor of the update path: it decides which release counts as "newer", it is
  // written into the durable journal as `currentVersion`, and a later rollback
  // offer reads that field back to decide where an installer may be sent. Two
  // implementations of one fact is a seam where the value used to DECIDE can
  // differ from the value RECORDED - and the null-returning variant turned a
  // hard failure into a `null` that compares as "cannot order" everywhere
  // downstream, silently disabling the checks that depend on it.
  //
  // Consolidated into electron/app-version.cjs on 2026-08-18. This guard exists
  // because the duplication is easy to reintroduce: the lazy-require idiom is
  // three lines, and writing it locally feels cheaper than adding an import.
  const LAZY_READER = "require('electron').app.getVersion()"

  function trackedElectronCjs() {
    return trackedFiles('electron/*.cjs', 'electron/**/*.cjs')
  }

  it('only app-version.cjs defines the lazy electron version reader', () => {
    const files = trackedElectronCjs()
    expect(files.length).toBeGreaterThan(20) // the sweep really ran
    const offenders = files
      .filter(file => path.basename(file) !== 'app-version.cjs')
      .filter(file => readFileSync(file, 'utf8').includes(LAZY_READER))
      .map(file => path.relative(root, file))
    expect(offenders, 'import { appVersion } from ./app-version.cjs instead of re-deriving it').toEqual([])
  })

  it('no module reintroduces a private defaultGetVersion helper', () => {
    // Named specifically, because that is what the three copies were called and
    // what a future edit would most naturally name a fourth.
    const files = trackedElectronCjs()
    const offenders = files
      .filter(file => /function\s+defaultGetVersion\s*\(/.test(readFileSync(file, 'utf8')))
      .map(file => path.relative(root, file))
    expect(offenders, 'the running app version has ONE reader: electron/app-version.cjs').toEqual([])
  })
})
