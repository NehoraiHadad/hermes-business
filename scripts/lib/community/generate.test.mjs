import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import {
  HISTORY_BACKFILL_LIMIT,
  WHATSAPP_TOOLSET,
  buildGatewayConfig,
  buildRoutes,
  dumpConfig,
  generateArtifacts,
  renderKnowledgeSkill,
  wakeWordPattern
} from './generate.mjs'
import { renderSoul } from './persona.mjs'

function contract() {
  return {
    name: 'כפר הדגמה',
    wakeWord: 'תכלס',
    admins: ['972501234567', '972529876543'],
    groups: [
      {
        slug: 'main',
        jid: '120363000000000001@g.us',
        name: 'קבוצת היישוב הראשית',
        purpose: 'שאלות כלליות, מידע יישובי',
        tone: 'default',
        knowledge: ['general']
      },
      {
        slug: 'emergency',
        jid: '120363000000000002@g.us',
        name: 'צח"י',
        purpose: 'חירום בלבד',
        tone: 'strict',
        knowledge: ['general', 'emergency']
      }
    ],
    knowledge: {
      general: { source: 'knowledge/general.md', description: 'מידע יישובי כללי' },
      emergency: { source: 'knowledge/emergency.md', description: 'נהלי חירום יישוביים' }
    }
  }
}

const sources = {
  'knowledge/general.md': '# מידע כללי\nשעות מזכירות: 08:00-12:00\n',
  'knowledge/emergency.md': '# חירום\nרכז צח"י: דוגמה\n'
}
const readSource = p => sources[p]

const gen = (existingConfigText = undefined) =>
  generateArtifacts(contract(), { readKnowledgeSource: readSource, existingConfigText })

describe('gateway config generation', () => {
  const cfg = () => yaml.load(gen()['config.yaml'])

  it('turns on gateway.multiplex_profiles (fact 1: routes are IGNORED without it)', () => {
    expect(cfg().gateway.multiplex_profiles).toBe(true)
  })

  it('emits one route per group: platform whatsapp, chat_id=JID, profile=slug, name=<slug>-route', () => {
    expect(cfg().profile_routes).toEqual([
      { name: 'main-route', platform: 'whatsapp', chat_id: '120363000000000001@g.us', profile: 'main' },
      { name: 'emergency-route', platform: 'whatsapp', chat_id: '120363000000000002@g.us', profile: 'emergency' }
    ])
  })

  it('allowlists the UNION of all group JIDs (acceptance is GLOBAL — fact 4)', () => {
    const wa = cfg().whatsapp
    expect(wa.group_policy).toBe('allowlist')
    expect(wa.group_allow_from).toEqual([
      '120363000000000001@g.us',
      '120363000000000002@g.us'
    ])
  })

  it('dedupes the JID union', () => {
    const c = contract()
    c.groups[1].jid = c.groups[0].jid // hypothetical duplicate (validation forbids it; generation still must not double)
    const wa = yaml.load(
      generateArtifacts(c, { readKnowledgeSource: readSource })['config.yaml']
    ).whatsapp
    expect(wa.group_allow_from).toEqual(['120363000000000001@g.us'])
  })

  it('fills BOTH admin keys from the contract admins (fact 8)', () => {
    const wa = cfg().whatsapp
    expect(wa.allow_admin_from).toEqual(['972501234567', '972529876543'])
    expect(wa.group_allow_admin_from).toEqual(['972501234567', '972529876543'])
  })

  it('requires a mention with the wake-word pattern, and disables DMs', () => {
    const wa = cfg().whatsapp
    expect(wa.require_mention).toBe(true)
    expect(wa.mention_patterns).toEqual(['^תכלס'])
    expect(wa.dm_policy).toBe('disabled')
  })

  it('escapes regex metacharacters in the wake word', () => {
    expect(wakeWordPattern('c++ (bot)')).toBe('^c\\+\\+ \\(bot\\)')
  })

  it(`enables history backfill with limit ${HISTORY_BACKFILL_LIMIT}`, () => {
    const wa = cfg().whatsapp
    expect(wa.history_backfill).toBe(true)
    expect(wa.history_backfill_limit).toBe(HISTORY_BACKFILL_LIMIT)
  })

  it('pins the reduced public-group toolset and the write-approval gates (spec §5.1)', () => {
    const c = cfg()
    expect(c.platform_toolsets.whatsapp).toEqual([...WHATSAPP_TOOLSET])
    expect(c.memory.write_approval).toBe(true)
    expect(c.skills.write_approval).toBe(true)
  })

  it('preserves the model block and other non-owned keys from an existing config', () => {
    const existing = yaml.dump({
      model: { provider: 'anthropic', name: 'claude-x' },
      api_keys: { anthropic: 'sk-test' },
      whatsapp: { bridge_dir: '/opt/bridge', dm_policy: 'open' },
      memory: { memory_enabled: false },
      gateway: { port: 18789, profile_routes: [{ name: 'stale', platform: 'whatsapp', chat_id: 'x@g.us', profile: 'old' }] }
    })
    const merged = yaml.load(gen(existing)['config.yaml'])
    expect(merged.model).toEqual({ provider: 'anthropic', name: 'claude-x' })
    expect(merged.api_keys).toEqual({ anthropic: 'sk-test' })
    expect(merged.whatsapp.bridge_dir).toBe('/opt/bridge') // non-owned whatsapp key survives
    expect(merged.whatsapp.dm_policy).toBe('disabled') // owned key is REWRITTEN from the contract
    expect(merged.memory.memory_enabled).toBe(false)
    expect(merged.memory.write_approval).toBe(true)
    expect(merged.gateway.port).toBe(18789)
    // Routes are canonicalized to ONE location: a stale nested list is dropped.
    expect(merged.gateway.profile_routes).toBeUndefined()
    expect(merged.profile_routes).toEqual(buildRoutes(contract()))
  })

  it('refuses a non-mapping existing config instead of clobbering it', () => {
    expect(() => buildGatewayConfig(contract(), '- a\n- list\n')).toThrow(/not a YAML mapping/)
  })

  it('dumps deterministically (stable key order, no folding)', () => {
    expect(dumpConfig(buildGatewayConfig(contract()))).toBe(dumpConfig(buildGatewayConfig(contract())))
  })
})

describe('per-group artifacts', () => {
  it('produces exactly the expected artifact paths', () => {
    expect(Object.keys(gen()).sort()).toEqual([
      'config.yaml',
      'profiles/emergency/SOUL.md',
      'profiles/emergency/skills/emergency/SKILL.md',
      'profiles/emergency/skills/general/SKILL.md',
      'profiles/main/SOUL.md',
      'profiles/main/skills/general/SKILL.md'
    ])
  })

  it('SOUL.md embeds the community name, wake word, group name and purpose', () => {
    const soul = gen()['profiles/main/SOUL.md']
    expect(soul).toContain('כפר הדגמה')
    expect(soul).toContain('תכלס')
    expect(soul).toContain('קבוצת היישוב הראשית')
    expect(soul).toContain('שאלות כלליות, מידע יישובי')
    // The no-invention anchor from the proven pilot persona.
    expect(soul).toContain('אל תמציא')
  })

  it('strict tone renders a terser, refer-to-admins-first persona; default does not', () => {
    const strict = gen()['profiles/emergency/SOUL.md']
    const relaxed = gen()['profiles/main/SOUL.md']
    expect(strict).not.toBe(relaxed)
    expect(strict).toContain('בכל ספק')
    expect(strict).toContain('משפט אחד או שניים')
    expect(relaxed).toContain('1–4 משפטים')
    expect(relaxed).not.toContain('משפט אחד או שניים')
  })

  it('renderSoul is deterministic', () => {
    const args = { communityName: 'x', wakeWord: 'y', group: contract().groups[0] }
    expect(renderSoul(args)).toBe(renderSoul(args))
  })

  it('knowledge skills carry valid frontmatter and the source content', () => {
    const skill = gen()['profiles/main/skills/general/SKILL.md']
    expect(skill.startsWith('---\nname: general\ndescription: ')).toBe(true)
    const [, frontmatter] = skill.split('---\n')
    const fm = yaml.load(frontmatter)
    expect(fm.name).toBe('general')
    expect(fm.description).toBe('מידע יישובי כללי')
    expect(fm.description.length).toBeLessThanOrEqual(60)
    expect(skill).toContain('שעות מזכירות: 08:00-12:00')
  })

  it('a shared pack renders IDENTICAL bytes into every declaring profile', () => {
    const a = gen()['profiles/main/skills/general/SKILL.md']
    const b = gen()['profiles/emergency/skills/general/SKILL.md']
    expect(a).toBe(b)
  })

  it('renderKnowledgeSkill fails closed on an over-budget description (fact 9)', () => {
    expect(() =>
      renderKnowledgeSkill({ pack: 'x', description: 'א'.repeat(61), sourcePath: 'k.md', sourceContent: 'y' })
    ).toThrow(/never load for routing/)
  })

  it('normalizes CRLF source content so artifacts are byte-stable across checkouts', () => {
    const skill = renderKnowledgeSkill({
      pack: 'x',
      description: 'ok',
      sourcePath: 'k.md',
      sourceContent: 'line1\r\nline2'
    })
    expect(skill).toContain('line1\nline2\n')
    expect(skill).not.toContain('\r')
  })

  it('generateArtifacts is a pure function: identical inputs → identical map', () => {
    expect(gen()).toEqual(gen())
  })

  it('fails closed when a knowledge source cannot be read', () => {
    expect(() => generateArtifacts(contract(), { readKnowledgeSource: () => undefined })).toThrow(/could not be read/)
    expect(() => generateArtifacts(contract(), {})).toThrow(TypeError)
  })
})
