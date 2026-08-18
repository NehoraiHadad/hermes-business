// Post-build guard for the "no companion self-update feed" claim.
// NOTE: no shebang — this module is BOTH a `node <script>` CLI and a library
// import (packaging-config.test.ts). A shebang in an ssr-inlined module lands
// mid-line after vitest hoists imports and kills collection with a stackless
// "SyntaxError: Invalid or unexpected token" (reproduced on CI runners; see
// scripts/lib/module-hygiene.test.mjs).
//
// This app ships no electron-updater consumer, so it must never emit auto-update
// metadata that would misrepresent a self-update capability. `build.publish` is
// set to `null` in package.json (officially supported by electron-builder) which
// stops it from inferring a GitHub/generic provider and writing a misleading
// `latest.yml`; `app-update.yml` is only produced when electron-updater is a
// runtime dependency, which it is not. This script is the fail-closed backstop:
// it scans the packaged output tree and hard-fails the build if any update-feed
// artifact slipped through, so the guarantee cannot silently regress.
// See docs/ACCEPTANCE.md §Update responsibility and packaging-config.test.ts.
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// latest.yml / latest-<arch>.yml (Windows feed), app-update.yml (updater config).
export const UPDATE_METADATA_RE = /^(latest(-[a-z0-9]+)?\.yml|app-update\.yml)$/i

export function isUpdateMetadataFile(name) {
  return UPDATE_METADATA_RE.test(name)
}

export function findUpdateMetadata(dir, hits = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return hits // directory absent → nothing was generated, which is the goal
  }
  for (const name of entries) {
    const full = join(dir, name)
    let s
    try {
      s = statSync(full)
    } catch {
      continue
    }
    if (s.isDirectory()) findUpdateMetadata(full, hits)
    else if (isUpdateMetadataFile(name)) hits.push(full)
  }
  return hits
}

function main() {
  const root = process.argv[2] || 'release'
  const hits = findUpdateMetadata(root)
  if (hits.length > 0) {
    console.error(
      `verify-no-update-metadata: FAIL — auto-update metadata found under "${root}":`
    )
    for (const h of hits) console.error(`  - ${h}`)
    console.error('This app publishes no self-update feed; see build.publish=null.')
    process.exit(1)
  }
  console.log(
    `verify-no-update-metadata: OK — no latest*.yml or app-update.yml under "${root}".`
  )
}

// Run the scan only when invoked as a CLI, not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}

export const __cliPath = fileURLToPath(import.meta.url)
