#!/usr/bin/env node
// Read-only: asserts a git tag name (v<version>) really names the version the
// checked-out HEAD's package.json carries, AND that the tag points at HEAD.
// One step of the release checklist (docs/RELEASING.md, spec §5.4 step 10 /
// docs/specs/versioning.md D2) — closes the "does the public tag name match the
// commit it's on" loop that the rest of the release contract (attestation,
// binding chain, ledger) does not cover, since none of those know about git tags
// at all. Mutates NOTHING: no git write, no file write, no network.
//
//   node scripts/verify-version-tag.mjs v0.4.0-alpha.2
//
// Exits 0 and prints a confirmation on success; exits 1 with an honest reason
// otherwise (tag malformed, version mismatch, tag missing, or tag not on HEAD).

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { repoRoot } from './lib/source-fingerprint.mjs'
import { decideVersionTag } from './lib/release/version-tag.mjs'

function readPackageVersion(root) {
  try {
    return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version || null
  } catch {
    return null
  }
}

function git(args, root) {
  try {
    return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').trim()
  } catch {
    return null
  }
}

/** Impure wrapper: reads package.json + shells to git, then decides. */
export function verifyVersionTag({ tag, root = repoRoot() } = {}) {
  const packageVersion = readPackageVersion(root)
  return decideVersionTag({
    tag,
    packageVersion,
    resolveTagCommit: t => git(['rev-list', '-n', '1', t], root),
    currentHead: () => git(['rev-parse', 'HEAD'], root)
  })
}

function main(argv) {
  const tag = argv[0]
  if (!tag) {
    console.error('usage: node scripts/verify-version-tag.mjs v<version>')
    return 1
  }
  const result = verifyVersionTag({ tag })
  if (!result.ok) {
    console.error(`verify-version-tag: FAIL [${result.code}] — ${result.reason}`)
    return 1
  }
  console.log(`verify-version-tag: OK — tag ${result.tag} names version ${result.version}, and points at HEAD.`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)))
}

export const __cliPath = fileURLToPath(import.meta.url)
