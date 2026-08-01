// Marker-level fail-closed coverage for UNSAFE tree records (companion to
// isolated-marker-failclose.test.mjs). Two invariants: an unsafe tree ROOT (a
// symlinked stable dir) fails the marker, and a byte-identical but over-depth tree
// stays digest_equal yet still fails profile_defining_unchanged. The walker that
// classifies these lives in isolated-marker-snapshot.mjs.
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hermesHomeMarker, markerDelta } from './isolated-marker.mjs'

const created = []
afterEach(() => {
  while (created.length) {
    try {
      rmSync(created.pop(), { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})
function seededHome() {
  const home = mkdtempSync(path.join(os.tmpdir(), 'marker-unsafe-'))
  created.push(home)
  writeFileSync(path.join(home, 'config.yaml'), 'x: 1\n')
  return home
}

describe('an unsafe tree ROOT fails the marker (absent≠unsafe root)', () => {
  it('a symlinked stable-tree root is one unsafe record that fails profile_defining_unchanged', () => {
    const home = seededHome()
    const target = mkdtempSync(path.join(os.tmpdir(), 'marker-target-'))
    created.push(target)
    writeFileSync(path.join(target, 'planted.md'), 'outside')
    let linked = false
    for (const type of ['junction', 'dir']) {
      try {
        symlinkSync(target, path.join(home, 'plugins'), type) // stable-tree ROOT is a symlink
        linked = true
        break
      } catch {
        /* unprivileged — skip */
      }
    }
    if (!linked) return
    const marker = hermesHomeMarker(home)
    expect(marker.treeUnsafe.plugins).toBeGreaterThanOrEqual(1) // root itself flagged unsafe
    const delta = markerDelta(marker, marker) // even against itself it cannot pass
    expect(delta.stable_unsafe_entries).toBeGreaterThanOrEqual(1)
    expect(delta.profile_defining_unchanged).toBe(false)
  })
})

describe('an unchanged unsafe entry cannot pass', () => {
  it('a byte-identical over-depth tree stays digest-equal yet fails profile_defining_unchanged', () => {
    const home = seededHome()
    let p = path.join(home, 'skills')
    for (let i = 0; i < 40; i++) { p = path.join(p, 'd'); mkdirSync(p, { recursive: true }) }
    const before = hermesHomeMarker(home)
    const after = hermesHomeMarker(home) // nothing mutated between snapshots
    const delta = markerDelta(before, after)
    expect(delta.digest_equal).toBe(true) // fingerprint identical...
    expect(delta.stable_unsafe_entries).toBeGreaterThanOrEqual(1) // ...but unsafe present
    expect(delta.profile_defining_unchanged).toBe(false) // so it can NEVER pass
  })
})
