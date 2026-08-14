import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import {
  ADMIN_SKILLS,
  ADMIN_TOOLSET,
  GROUP_TOOLSET,
  HISTORY_BACKFILL_LIMIT,
  OWNED_ENV,
  buildEnvFile,
  buildGatewayConfig,
  buildProfileConfig,
  buildRoutes,
  dumpConfig,
  generateArtifacts,
  renderAdminSkill,
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

// Hermetic admin-skill template fakes (the SHIPPED assets are validated by
// admin-skills.test.mjs against the real files).
const adminTemplates = {
  'community-bootstrap': [
    '---',
    'name: community-bootstrap',
    'description: "הקמת קהילה"',
    '---',
    '',
    'הבית: {{HOME_DIR}}',
    'החוזה: {{CONTRACT_PATH}}',
    'גנרטור: {{GENERATE_CLI}}',
    'provisioning: {{PROVISION_CLI}}',
    'שורש: {{INSTALL_ROOT}}',
    ''
  ].join('\n'),
  'community-admin': [
    '---',
    'name: community-admin',
    'description: "ניהול קהילה"',
    '---',
    '',
    'node "{{GENERATE_CLI}}" verify --contract "{{CONTRACT_PATH}}" --home "{{HOME_DIR}}"',
    ''
  ].join('\n')
}

const deployPaths = {
  HOME_DIR: 'C:\\Community\\home',
  CONTRACT_PATH: 'C:\\Community\\community.yaml',
  INSTALL_ROOT: 'C:\\Community',
  GENERATE_CLI: 'C:\\App\\scripts\\community-generate.mjs',
  PROVISION_CLI: 'C:\\App\\scripts\\community-provision.mjs'
}

const gen = (overrides = {}) =>
  generateArtifacts(contract(), {
    readKnowledgeSource: readSource,
    readAdminSkillTemplate: name => adminTemplates[name],
    deployPaths,
    ...overrides
  })

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
      generateArtifacts(c, {
        readKnowledgeSource: readSource,
        readAdminSkillTemplate: name => adminTemplates[name],
        deployPaths
      })['config.yaml']
    ).whatsapp
    expect(wa.group_allow_from).toEqual(['120363000000000001@g.us'])
  })

  it('fills BOTH admin keys from the contract admins (fact 8)', () => {
    const wa = cfg().whatsapp
    expect(wa.allow_admin_from).toEqual(['972501234567', '972529876543'])
    expect(wa.group_allow_admin_from).toEqual(['972501234567', '972529876543'])
  })

  it('requires a mention with the wake-word pattern', () => {
    const wa = cfg().whatsapp
    expect(wa.require_mention).toBe(true)
    expect(wa.mention_patterns).toEqual(['^תכלס'])
  })

  it('admin-only DMs (§6.1): gateway dm_policy=allowlist over the admins, bridge stays open via .env', () => {
    const wa = cfg().whatsapp
    // Gateway layer: config allowlist wins over the env var at the adapter
    // (adapter.py:442-454) — only admins may DM, everything else is silently
    // dropped (whatsapp_common.py:276-289).
    expect(wa.dm_policy).toBe('allowlist')
    expect(wa.allow_from).toEqual(['972501234567', '972529876543'])
    // Bridge layer: the bot-mode sender gate applies to GROUP participants too
    // (bridge.js:652, empty allowlist = deny-all) — '*' keeps resident group
    // traffic flowing so the gateway is the single enforcement point.
    expect(OWNED_ENV.WHATSAPP_ALLOWED_USERS).toBe('*')
    expect(OWNED_ENV.WHATSAPP_MODE).toBe('bot')
  })

  it('escapes regex metacharacters in the wake word', () => {
    expect(wakeWordPattern('c++ (bot)')).toBe('^c\\+\\+ \\(bot\\)')
  })

  it(`enables history backfill with limit ${HISTORY_BACKFILL_LIMIT}`, () => {
    const wa = cfg().whatsapp
    expect(wa.history_backfill).toBe(true)
    expect(wa.history_backfill_limit).toBe(HISTORY_BACKFILL_LIMIT)
  })

  it('pins the ADMIN toolset on the ROOT config (default profile = admin DM channel, §6.1)', () => {
    const c = cfg()
    expect(c.platform_toolsets.whatsapp).toEqual([...ADMIN_TOOLSET])
    expect(c.memory.write_approval).toBe(true)
    expect(c.skills.write_approval).toBe(true)
  })

  it('the ADMIN toolset can run the CLIs (terminal+file) but never code_execution/delegation', () => {
    expect(ADMIN_TOOLSET).toContain('terminal')
    expect(ADMIN_TOOLSET).toContain('file')
    expect(ADMIN_TOOLSET).not.toContain('code_execution')
    expect(ADMIN_TOOLSET).not.toContain('delegation')
  })

  it('preserves the model block and other non-owned keys from an existing config', () => {
    const existing = yaml.dump({
      model: { provider: 'anthropic', name: 'claude-x' },
      api_keys: { anthropic: 'sk-test' },
      whatsapp: { bridge_dir: '/opt/bridge', dm_policy: 'open' },
      memory: { memory_enabled: false },
      gateway: { port: 18789, profile_routes: [{ name: 'stale', platform: 'whatsapp', chat_id: 'x@g.us', profile: 'old' }] }
    })
    const merged = yaml.load(gen({ existingConfigText: existing })['config.yaml'])
    expect(merged.model).toEqual({ provider: 'anthropic', name: 'claude-x' })
    expect(merged.api_keys).toEqual({ anthropic: 'sk-test' })
    expect(merged.whatsapp.bridge_dir).toBe('/opt/bridge') // non-owned whatsapp key survives
    expect(merged.whatsapp.dm_policy).toBe('allowlist') // owned key is REWRITTEN from the contract
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

describe('.env generation (bridge posture — proven pilot pattern)', () => {
  it('a fresh home gets exactly the owned keys', () => {
    expect(gen()['.env']).toBe('WHATSAPP_ENABLED=true\nWHATSAPP_MODE=bot\nWHATSAPP_ALLOWED_USERS=*\n')
  })

  it('preserves non-owned lines (comments, other keys, engine-written entries) verbatim', () => {
    const existing = '# operator note\nOPENAI_API_KEY=sk-abc\nWHATSAPP_MODE=self-chat\nCUSTOM=1\n'
    const out = buildEnvFile(existing)
    expect(out).toContain('# operator note')
    expect(out).toContain('OPENAI_API_KEY=sk-abc')
    expect(out).toContain('CUSTOM=1')
    expect(out).toContain('WHATSAPP_MODE=bot') // owned key rewritten IN PLACE
    expect(out).not.toContain('self-chat')
  })

  it('drops stale duplicates of an owned key (dotenv last-wins would override us)', () => {
    const out = buildEnvFile('WHATSAPP_ALLOWED_USERS=*\nX=1\nWHATSAPP_ALLOWED_USERS=972501234567\n')
    expect(out.match(/WHATSAPP_ALLOWED_USERS/g)).toHaveLength(1)
    expect(out).toContain('WHATSAPP_ALLOWED_USERS=*')
    expect(out).not.toContain('972501234567')
  })

  it('appends missing owned keys and ends with exactly one trailing newline', () => {
    const out = buildEnvFile('FOO=bar')
    expect(out.startsWith('FOO=bar\n')).toBe(true)
    for (const [k, v] of Object.entries(OWNED_ENV)) expect(out).toContain(`${k}=${v}`)
    expect(out.endsWith('\n')).toBe(true)
    expect(out.endsWith('\n\n')).toBe(false)
  })
})

describe('per-group artifacts', () => {
  it('produces exactly the expected artifact paths (incl. profile configs + admin skills)', () => {
    expect(Object.keys(gen()).sort()).toEqual([
      '.env',
      'config.yaml',
      'profiles/emergency/SOUL.md',
      'profiles/emergency/config.yaml',
      'profiles/emergency/skills/emergency/SKILL.md',
      'profiles/emergency/skills/general/SKILL.md',
      'profiles/main/SOUL.md',
      'profiles/main/config.yaml',
      'profiles/main/skills/general/SKILL.md',
      'skills/community-admin/SKILL.md',
      'skills/community-bootstrap/SKILL.md'
    ])
  })

  it('every group profile pins the FENCED toolset in its own config.yaml (§6.1 — absent config = FULL default toolset)', () => {
    for (const slug of ['main', 'emergency']) {
      const pc = yaml.load(gen()[`profiles/${slug}/config.yaml`])
      expect(pc.platform_toolsets.whatsapp).toEqual([...GROUP_TOOLSET])
      expect(pc.memory.write_approval).toBe(true)
      expect(pc.skills.write_approval).toBe(true)
    }
  })

  it('the fenced GROUP toolset exposes no config/file/terminal capability (hard audience boundary)', () => {
    for (const banned of ['terminal', 'file', 'code_execution', 'delegation', 'cronjob', 'memory']) {
      expect(GROUP_TOOLSET).not.toContain(banned)
    }
  })

  it('profile config merges over an existing profile config, preserving non-owned keys', () => {
    const merged = yaml.load(
      gen({
        readProfileConfigText: slug =>
          slug === 'main' ? yaml.dump({ model: { name: 'per-group-model' }, platform_toolsets: { whatsapp: ['terminal'] } }) : undefined
      })['profiles/main/config.yaml']
    )
    expect(merged.model).toEqual({ name: 'per-group-model' })
    expect(merged.platform_toolsets.whatsapp).toEqual([...GROUP_TOOLSET]) // owned: rewritten
  })

  it('buildProfileConfig refuses a non-mapping existing profile config', () => {
    expect(() => buildProfileConfig('- nope\n')).toThrow(/not a YAML mapping/)
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
    expect(() => gen({ readKnowledgeSource: () => undefined })).toThrow(/could not be read/)
    expect(() => generateArtifacts(contract(), {})).toThrow(TypeError)
  })
})

describe('admin skills (default profile only)', () => {
  it('installs every ADMIN_SKILLS entry under skills/ (default profile), never under group profiles', () => {
    const artifacts = gen()
    for (const name of ADMIN_SKILLS) {
      expect(artifacts[`skills/${name}/SKILL.md`]).toBeDefined()
      for (const slug of ['main', 'emergency']) {
        expect(artifacts[`profiles/${slug}/skills/${name}/SKILL.md`]).toBeUndefined()
      }
    }
  })

  it('substitutes every deployment path into the installed skill', () => {
    const boot = gen()['skills/community-bootstrap/SKILL.md']
    for (const value of Object.values(deployPaths)) expect(boot).toContain(value)
    expect(boot).not.toMatch(/\{\{[A-Z_]+\}\}/)
  })

  it('fails closed when a template is missing', () => {
    expect(() => gen({ readAdminSkillTemplate: () => undefined })).toThrow(/could not be read/)
    expect(() => generateArtifacts(contract(), { readKnowledgeSource: readSource })).toThrow(TypeError)
  })

  it('renderAdminSkill refuses a missing deploy path (unresolved commands are worse than an error)', () => {
    expect(() =>
      renderAdminSkill({
        name: 'community-admin',
        template: adminTemplates['community-admin'],
        deployPaths: { ...deployPaths, HOME_DIR: '' }
      })
    ).toThrow(/HOME_DIR is required/)
  })

  it('renderAdminSkill refuses an unknown placeholder', () => {
    expect(() =>
      renderAdminSkill({
        name: 'community-admin',
        template: '---\nname: community-admin\ndescription: "x"\n---\n{{NOPE}}\n',
        deployPaths
      })
    ).toThrow(/unknown placeholder/)
  })

  it('renderAdminSkill refuses a frontmatter name that differs from the skill directory', () => {
    expect(() =>
      renderAdminSkill({
        name: 'community-admin',
        template: '---\nname: other\ndescription: "x"\n---\nbody\n',
        deployPaths
      })
    ).toThrow(/must equal the skill directory name/)
  })

  it('renderAdminSkill enforces the 60-char routing budget on the description (fact 9)', () => {
    expect(() =>
      renderAdminSkill({
        name: 'community-admin',
        template: `---\nname: community-admin\ndescription: "${'א'.repeat(61)}"\n---\nbody\n`,
        deployPaths
      })
    ).toThrow(/routing budget/)
  })
})
