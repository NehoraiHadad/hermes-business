// Fail-closed coverage for the additions to the profile marker:
//   • desktop-plugins/ + business/ are now PROTECTED stable trees (app-managed but
//     the isolated run must not disturb them) — nested changes must fail.
//   • a plugin .env is authored content (hashed), while exact Curator metadata is
//     runtime churn (skipped).
// Unsafe-root / unchanged-unsafe-entry coverage lives in isolated-marker-unsafe.test.mjs.
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
  const home = mkdtempSync(path.join(os.tmpdir(), 'marker-fc-'))
  created.push(home)
  writeFileSync(path.join(home, 'config.yaml'), 'x: 1\n')
  return home
}
function put(home, rel, body) {
  const abs = path.join(home, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, body)
}

describe('app-managed trees (desktop-plugins, business) are protected', () => {
  it('a nested desktop-plugins edit fails closed (companion reinstall/tamper)', () => {
    const home = seededHome()
    put(home, 'desktop-plugins/companion/main.js', 'v1')
    const before = hermesHomeMarker(home)
    put(home, 'desktop-plugins/companion/main.js', 'v2 — a longer rewritten body')
    const delta = markerDelta(before, hermesHomeMarker(home))
    expect(delta.stable_content_changed['desktop-plugins']).toBe(1)
    expect(delta.profile_defining_unchanged).toBe(false)
    expect(delta.digest_equal).toBe(false)
  })

  it('a nested business SAME-SIZE rewrite fails closed (partner policy tamper)', () => {
    const home = seededHome()
    put(home, 'business/whatsapp-policy.json', 'AAAAAAAA')
    const before = hermesHomeMarker(home)
    put(home, 'business/whatsapp-policy.json', 'BBBBBBBB') // identical length
    const delta = markerDelta(before, hermesHomeMarker(home))
    expect(delta.stable_content_changed.business).toBe(1)
    expect(delta.profile_defining_unchanged).toBe(false)
    expect(delta.digest_equal).toBe(false)
  })

  it('an absent business/desktop-plugins tree is a safe pass (not unsafe)', () => {
    const home = seededHome()
    const before = hermesHomeMarker(home)
    const delta = markerDelta(before, hermesHomeMarker(home))
    expect(delta.stable_unsafe_entries).toBe(0)
    expect(delta.profile_defining_unchanged).toBe(true)
  })
})

describe('plugin .env is protected while Curator metadata is churn', () => {
  it('a plugin .env same-size rewrite flips the marker; curator metadata alone does not', () => {
    const home = seededHome()
    put(home, 'skills/foo/SKILL.md', '# s')
    put(home, 'plugins/p/.env', 'K=aaaa')
    const before = hermesHomeMarker(home)
    put(home, 'skills/foo/.curator_state', 'live-churn') // allowlisted runtime metadata
    expect(markerDelta(before, hermesHomeMarker(home)).profile_defining_unchanged).toBe(true)
    put(home, 'plugins/p/.env', 'K=bbbb') // same-size authored rewrite — protected
    const delta = markerDelta(before, hermesHomeMarker(home))
    expect(delta.stable_content_changed.plugins).toBe(1)
    expect(delta.profile_defining_unchanged).toBe(false)
  })
})

describe('runtime metadata exclusion is SKILLS-scoped, not global', () => {
  it('skills Curator/learning metadata churn is ignored (live gateway rewrites)', () => {
    const home = seededHome()
    put(home, 'skills/foo/SKILL.md', '# s')
    const before = hermesHomeMarker(home)
    put(home, 'skills/.usage.json', '{"foo":42}') // learning_graph.py churn
    put(home, 'skills/foo/.curator_state', 'live') // curator.py churn
    put(home, 'skills/.bundled_manifest', 'm')
    const delta = markerDelta(before, hermesHomeMarker(home))
    expect(delta.profile_defining_unchanged).toBe(true)
    expect(delta.digest_equal).toBe(true)
  })

  it('a plugins/.usage.json same-size rewrite IS detected (authored, not churn)', () => {
    const home = seededHome()
    put(home, 'plugins/p/.usage.json', 'AAAAAAAA')
    const before = hermesHomeMarker(home)
    put(home, 'plugins/p/.usage.json', 'BBBBBBBB') // identical length authored rewrite
    const delta = markerDelta(before, hermesHomeMarker(home))
    expect(delta.stable_content_changed.plugins).toBe(1)
    expect(delta.profile_defining_unchanged).toBe(false)
    expect(delta.digest_equal).toBe(false)
  })

  it('a business/.curator_state same-size rewrite IS detected (partner content)', () => {
    const home = seededHome()
    put(home, 'business/.curator_state', 'AAAAAAAA')
    const before = hermesHomeMarker(home)
    put(home, 'business/.curator_state', 'BBBBBBBB') // identical length authored rewrite
    const delta = markerDelta(before, hermesHomeMarker(home))
    expect(delta.stable_content_changed.business).toBe(1)
    expect(delta.profile_defining_unchanged).toBe(false)
    expect(delta.digest_equal).toBe(false)
  })
})
