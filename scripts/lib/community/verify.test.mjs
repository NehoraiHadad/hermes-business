import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import { generateArtifacts } from './generate.mjs'
import {
  contentChecksum,
  diffOwnedViews,
  effectiveOwnedView,
  expectedOwnedView,
  verifyArtifacts
} from './verify.mjs'

function contract() {
  return {
    name: 'כפר הדגמה',
    wakeWord: 'תכלס',
    admins: ['972501234567'],
    groups: [
      {
        slug: 'main',
        jid: '120363000000000001@g.us',
        name: 'ראשית',
        purpose: 'מידע כללי',
        tone: 'default',
        knowledge: ['general']
      },
      {
        slug: 'emergency',
        jid: '120363000000000002@g.us',
        name: 'צח"י',
        purpose: 'חירום בלבד',
        tone: 'strict',
        knowledge: []
      }
    ],
    knowledge: { general: { source: 'knowledge/general.md', description: 'מידע יישובי כללי' } }
  }
}

const sources = { 'knowledge/general.md': '# ידע\nתוכן\n' }
const gen = () => generateArtifacts(contract(), { readKnowledgeSource: p => sources[p] })

// A fake home: relPath → content (null = absent).
const homeReader = files => relPath => (relPath in files ? files[relPath] : null)

describe('verifyArtifacts — clean home', () => {
  it('verifies a freshly generated home as ok on every artifact', () => {
    const artifacts = gen()
    const report = verifyArtifacts(contract(), artifacts, { readFile: homeReader({ ...artifacts }) })
    expect(report.ok).toBe(true)
    expect(report.artifacts.map(a => a.status)).toEqual(report.artifacts.map(() => 'ok'))
    expect(report.artifacts.map(a => a.path)).toContain('config.yaml')
    expect(report.artifacts.map(a => a.path)).toContain('profiles/main/skills/general/SKILL.md')
  })
})

describe('verifyArtifacts — the engine REWRITES config.yaml (values, not text)', () => {
  it('tolerates comment stripping, key reordering and list reordering', () => {
    const artifacts = gen()
    const parsed = yaml.load(artifacts['config.yaml'])
    // Simulate the observed engine rewrite: different key order, no comments,
    // reordered lists, routes moved to the NESTED gateway.profile_routes form.
    const rewritten = [
      '# rewritten by the engine',
      yaml.dump(
        {
          skills: parsed.skills,
          memory: parsed.memory,
          platform_toolsets: { whatsapp: [...parsed.platform_toolsets.whatsapp].reverse() },
          whatsapp: {
            ...parsed.whatsapp,
            group_allow_from: [...parsed.whatsapp.group_allow_from].reverse()
          },
          gateway: {
            ...parsed.gateway,
            profile_routes: [...parsed.profile_routes].reverse()
          }
        },
        { sortKeys: false }
      )
    ].join('\n')
    const home = { ...artifacts, 'config.yaml': rewritten }
    const report = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) })
    expect(report.ok, JSON.stringify(report.artifacts, null, 2)).toBe(true)
  })

  it('flags a flipped owned VALUE as drift, naming the key', () => {
    const artifacts = gen()
    const parsed = yaml.load(artifacts['config.yaml'])
    parsed.whatsapp.require_mention = false
    const home = { ...artifacts, 'config.yaml': yaml.dump(parsed) }
    const report = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) })
    expect(report.ok).toBe(false)
    const entry = report.artifacts.find(a => a.path === 'config.yaml')
    expect(entry.status).toBe('drift')
    expect(entry.detail).toContain('whatsapp.require_mention')
  })

  it('flags a JID missing from the allowlist union', () => {
    const artifacts = gen()
    const parsed = yaml.load(artifacts['config.yaml'])
    parsed.whatsapp.group_allow_from = ['120363000000000001@g.us'] // second group dropped
    const home = { ...artifacts, 'config.yaml': yaml.dump(parsed) }
    const entry = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) }).artifacts.find(
      a => a.path === 'config.yaml'
    )
    expect(entry.status).toBe('drift')
    expect(entry.detail).toContain('whatsapp.group_allow_from')
  })

  it('flags multiplex_profiles turned off (routes would be silently ignored — fact 1)', () => {
    const artifacts = gen()
    const parsed = yaml.load(artifacts['config.yaml'])
    parsed.gateway.multiplex_profiles = false
    const home = { ...artifacts, 'config.yaml': yaml.dump(parsed) }
    const entry = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) }).artifacts.find(
      a => a.path === 'config.yaml'
    )
    expect(entry.status).toBe('drift')
    expect(entry.detail).toContain('gateway.multiplex_profiles')
  })

  it('flags unparseable config as drift, and a missing config as missing', () => {
    const artifacts = gen()
    const broken = verifyArtifacts(contract(), artifacts, {
      readFile: homeReader({ ...artifacts, 'config.yaml': ':\n  - not: [valid' })
    }).artifacts.find(a => a.path === 'config.yaml')
    expect(broken.status).toBe('drift')
    const absent = verifyArtifacts(contract(), artifacts, {
      readFile: homeReader(Object.fromEntries(Object.entries(artifacts).filter(([p]) => p !== 'config.yaml')))
    }).artifacts.find(a => a.path === 'config.yaml')
    expect(absent.status).toBe('missing')
  })
})

describe('verifyArtifacts — text artifacts by checksum', () => {
  it('flags an edited SOUL.md as drift', () => {
    const artifacts = gen()
    const home = { ...artifacts, 'profiles/main/SOUL.md': artifacts['profiles/main/SOUL.md'] + '\nעריכה ידנית\n' }
    const report = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) })
    const entry = report.artifacts.find(a => a.path === 'profiles/main/SOUL.md')
    expect(entry.status).toBe('drift')
    expect(report.ok).toBe(false)
  })

  it('reports a deleted knowledge skill as missing', () => {
    const artifacts = gen()
    const home = Object.fromEntries(
      Object.entries(artifacts).filter(([p]) => p !== 'profiles/main/skills/general/SKILL.md')
    )
    const entry = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) }).artifacts.find(
      a => a.path === 'profiles/main/skills/general/SKILL.md'
    )
    expect(entry.status).toBe('missing')
  })

  it('tolerates CRLF line endings on disk (Windows checkout of a generated file)', () => {
    const artifacts = gen()
    const home = { ...artifacts, 'profiles/main/SOUL.md': artifacts['profiles/main/SOUL.md'].replace(/\n/g, '\r\n') }
    const entry = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) }).artifacts.find(
      a => a.path === 'profiles/main/SOUL.md'
    )
    expect(entry.status).toBe('ok')
  })

  it('contentChecksum normalizes CRLF and is stable', () => {
    expect(contentChecksum('a\r\nb')).toBe(contentChecksum('a\nb'))
    expect(contentChecksum('a')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('effective owned view', () => {
  it('expectedOwnedView is derived from the contract alone', () => {
    const view = expectedOwnedView(contract())
    expect(view['gateway.multiplex_profiles']).toBe(true)
    expect(view['whatsapp.dm_policy']).toBe('disabled')
    expect(view.profile_routes.map(r => r.profile).sort()).toEqual(['emergency', 'main'])
  })

  it('reads routes from either the top-level or nested gateway form', () => {
    const top = effectiveOwnedView({ profile_routes: [{ name: 'r', platform: 'whatsapp', chat_id: 'x@g.us', profile: 'p' }] })
    const nested = effectiveOwnedView({
      gateway: { profile_routes: [{ name: 'r', platform: 'whatsapp', chat_id: 'x@g.us', profile: 'p' }] }
    })
    expect(top.profile_routes).toEqual(nested.profile_routes)
  })

  it('diffOwnedViews returns only the drifted key paths', () => {
    const a = expectedOwnedView(contract())
    const b = { ...a, 'whatsapp.dm_policy': 'open' }
    expect(diffOwnedViews(a, b)).toEqual(['whatsapp.dm_policy'])
    expect(diffOwnedViews(a, { ...a })).toEqual([])
  })
})
