// A native model picker can discover OS-backed `gh auth token` credentials even
// with an empty Hermes home. Suppress that source in these read-only UI tests.
import assert from 'node:assert/strict'
import { realpathSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function seedMakomTestAuth(home) {
  const directory = realpathSync(home)
  assert.ok(directory.startsWith(realpathSync(os.tmpdir()) + path.sep), 'Test auth must stay in temp')
  writeFileSync(path.join(directory, 'auth.json'), JSON.stringify({ version: 1, providers: {},
    suppressed_sources: { copilot: ['gh_cli', 'env:COPILOT_GITHUB_TOKEN', 'env:GH_TOKEN', 'env:GITHUB_TOKEN'] }
  }), { flag: 'wx' })
}
