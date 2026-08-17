import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import {
  ADMIN_SKILLS,
  ADMIN_TOOLSET,
  DM_OPEN_PLATFORMS,
  RESIDENT_TOOLSET,
  COMMUNITY_ARCHIVE_PLUGIN,
  COMMUNITY_ARCHIVE_PLUGIN_FILES,
  COMMUNITY_ARCHIVE_TOOL,
  GROUP_TOOLSET,
  HISTORY_BACKFILL_LIMIT,
  OWNED_ENV,
  SHARED_TOOLSET,
  buildEnvFile,
  buildArchivePolicy,
  buildEgressPolicy,
  buildGatewayConfig,
  buildProfileConfig,
  buildRoutes,
  dumpConfig,
  generateArtifacts,
  renderAdminSkill,
  renderKnowledgeSkill,
  spaceOwnedEnv,
  wakeWordPattern
} from './generate.mjs'
import { ADMIN_SPACE, RESIDENT_SPACE, SHARED_SPACE, contractSpaces } from './contract.mjs'
import { renderResidentSoul, renderSharedSoul, renderSoul } from './persona.mjs'

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
        isolated: false,
        knowledge: ['general']
      },
      {
        slug: 'emergency',
        jid: '120363000000000002@g.us',
        name: 'צח"י',
        purpose: 'חירום בלבד',
        tone: 'strict',
        isolated: true,
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
const readCommunityPluginFile = name => `# runtime fixture: ${name}\n`

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
    readCommunityPluginFile,
    deployPaths,
    ...overrides
  })

describe('gateway config generation', () => {
  const cfg = () => yaml.load(gen()['config.yaml'])

  it('turns on gateway.multiplex_profiles (fact 1: routes are IGNORED without it)', () => {
    expect(cfg().gateway.multiplex_profiles).toBe(true)
  })

  it('emits one route per group onto its SPACE profile (§2.1): shared → village, isolated → own slug', () => {
    expect(cfg().profile_routes).toEqual([
      { name: 'main-route', platform: 'whatsapp', chat_id: '120363000000000001@g.us', profile: SHARED_SPACE },
      { name: 'emergency-route', platform: 'whatsapp', chat_id: '120363000000000002@g.us', profile: 'emergency' },
      // DM model: each admin's DM routes to the management space...
      { name: 'admin-dm-972501234567', platform: 'whatsapp', chat_id: '972501234567@s.whatsapp.net', profile: ADMIN_SPACE },
      { name: 'admin-dm-972529876543', platform: 'whatsapp', chat_id: '972529876543@s.whatsapp.net', profile: ADMIN_SPACE }
      // ...and under the DEFAULT dms:'admins' there is NO resident fallback —
      // strangers are filtered by the native intake gate, not routed.
    ])
  })

  it('several shared groups route onto ONE village profile with unique per-group route names', () => {
    const c = contract()
    c.groups.push({
      slug: 'parents',
      jid: '120363000000000003@g.us',
      name: 'הורים',
      purpose: 'בית ספר וגנים',
      tone: 'default',
      isolated: false,
      knowledge: []
    })
    const routes = buildRoutes(c)
    expect(routes.filter(r => r.chat_id?.endsWith('@g.us')).map(r => r.profile)).toEqual([SHARED_SPACE, 'emergency', SHARED_SPACE])
    // Route names stay unique per group (engine treats name as log-only, but
    // uniqueness keeps the logs unambiguous).
    expect(new Set(routes.map(r => r.name)).size).toBe(routes.length)
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
        readCommunityPluginFile,
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

  it('keeps resident slash commands closed in groups while admin DMs retain the Hermes floor', () => {
    expect(cfg().whatsapp.group_user_allowed_commands).toEqual([])
  })

  it('enables durable observation alongside the immediate 50-message context', () => {
    const whatsapp = cfg().whatsapp
    expect(whatsapp.observe_unmentioned_group_messages).toBe(true)
    expect(whatsapp.observe_allowed_chats).toEqual([contract().groups[0].jid])
  })

  it('enables the archive plugin without privileged tool override', () => {
    const plugins = cfg().plugins
    expect(plugins.enabled).toContain(COMMUNITY_ARCHIVE_PLUGIN)
    expect(plugins.disabled).not.toContain(COMMUNITY_ARCHIVE_PLUGIN)
    expect(plugins.entries[COMMUNITY_ARCHIVE_PLUGIN].allow_tool_override).toBe(false)
  })

  it('leaves the ROOT toolset to the owner entirely and keeps session_search at root', () => {
    const c = cfg()
    // Every WhatsApp audience is routed to a space profile; ADMIN_TOOLSET
    // lives in profiles/admin, so the root toolset is not even seeded.
    expect(c.platform_toolsets?.whatsapp).toBeUndefined()
    expect(c.memory.write_approval).toBe(true)
    expect(c.skills.write_approval).toBe(true)
    // Single-home decision (2026-08-16): the ROOT is the owner's own
    // assistant — session_search stays enabled there. The fence lives in the
    // space profiles only.
    expect(c.agent?.disabled_toolsets ?? []).not.toContain('session_search')
  })

  it('keeps an existing home’s explicit toolset and approvals (community is additive)', () => {
    const existing = yaml.dump({
      platform_toolsets: { whatsapp: ['web', 'terminal', 'code_execution'] },
      memory: { write_approval: false },
      skills: { write_approval: false }
    })
    const c = yaml.load(gen({ existingConfigText: existing })['config.yaml'])
    expect(c.platform_toolsets.whatsapp).toEqual(['web', 'terminal', 'code_execution'])
    expect(c.memory.write_approval).toBe(false)
    expect(c.skills.write_approval).toBe(false)
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
    expect(merged.whatsapp.dm_policy).toBe('allowlist') // dm_policy is contract-OWNED: default dms:'admins' filters strangers at intake
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

  it('UNIONS allow lists and mention patterns with an existing business home', () => {
    const existing = yaml.dump({
      whatsapp: {
        allow_from: ['972999999999'],
        group_allow_from: ['120363999999999999@g.us'],
        allow_admin_from: ['972999999999'],
        mention_patterns: ['^עסק']
      }
    })
    const wa = yaml.load(gen({ existingConfigText: existing })['config.yaml']).whatsapp
    const admins = contract().admins
    const jids = contract().groups.map(g => g.jid)
    expect(wa.allow_from).toEqual(expect.arrayContaining(['972999999999', ...admins]))
    expect(wa.group_allow_from).toEqual(expect.arrayContaining(['120363999999999999@g.us', ...jids]))
    expect(wa.allow_admin_from).toEqual(expect.arrayContaining(['972999999999', ...admins]))
    expect(wa.mention_patterns).toEqual(expect.arrayContaining(['^עסק', wakeWordPattern(contract().wakeWord)]))
    // The retention fence stays EXACT — never unioned with pre-existing groups.
    expect(wa.observe_allowed_chats).toEqual(
      contract().groups.filter(g => g.isolated !== true).map(g => g.jid)
    )
  })

  it('preserves foreign profile_routes and regenerates only contract-claimed ones', () => {
    const foreign = { name: 'biz-team', platform: 'discord', chat_id: '123', profile: 'work' }
    const stale = { name: 'stale', platform: 'whatsapp', chat_id: contract().groups[0].jid, profile: 'old-space' }
    const staleVillage = { name: 'old-village', platform: 'whatsapp', chat_id: 'x@g.us', profile: SHARED_SPACE }
    const existing = yaml.dump({ profile_routes: [foreign, stale, staleVillage] })
    const routes = yaml.load(gen({ existingConfigText: existing })['config.yaml']).profile_routes
    expect(routes).toContainEqual(foreign)
    expect(routes.filter(r => r.chat_id === contract().groups[0].jid)).toEqual(
      buildRoutes(contract()).filter(r => r.chat_id === contract().groups[0].jid)
    )
    expect(routes.find(r => r.name === 'old-village')).toBeUndefined()
    expect(routes.find(r => r.name === 'stale')).toBeUndefined()
  })

  it('dumps deterministically (stable key order, no folding)', () => {
    expect(dumpConfig(buildGatewayConfig(contract()))).toBe(dumpConfig(buildGatewayConfig(contract())))
  })
})

describe('.env generation (bridge posture — proven pilot pattern)', () => {
  it('a fresh home gets exactly the owned keys (incl. the intake-time group allowlist)', () => {
    expect(gen()['.env']).toBe(
      'WHATSAPP_ENABLED=true\nWHATSAPP_MODE=bot\nWHATSAPP_ALLOWED_USERS=*\n' +
        'WHATSAPP_GROUP_ALLOWED_USERS=120363000000000001@g.us,120363000000000002@g.us\n'
    )
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

describe('per-space artifacts (§2.1)', () => {
  it('produces exactly the expected artifact paths: profiles are per SPACE, not per group', () => {
    expect(Object.keys(gen()).sort()).toEqual([
      '.env',
      'business/whatsapp-policy.json',
      'community/archive-policy.json',
      'config.yaml',
      'profiles/emergency/.env',
      'profiles/emergency/SOUL.md',
      'profiles/emergency/config.yaml',
      'profiles/emergency/skills/emergency/SKILL.md',
      'profiles/emergency/skills/general/SKILL.md',
      ...COMMUNITY_ARCHIVE_PLUGIN_FILES.map(name => `plugins/${COMMUNITY_ARCHIVE_PLUGIN}/${name}`),
      ...COMMUNITY_ARCHIVE_PLUGIN_FILES.map(name => `profiles/${SHARED_SPACE}/plugins/${COMMUNITY_ARCHIVE_PLUGIN}/${name}`),
      `profiles/${SHARED_SPACE}/.env`,
      `profiles/${SHARED_SPACE}/SOUL.md`,
      `profiles/${SHARED_SPACE}/config.yaml`,
      `profiles/${SHARED_SPACE}/skills/general/SKILL.md`,
      // The management space: admins' routed DM channel — admin skills,
      // archive plugin, and its own SOUL.
      ...COMMUNITY_ARCHIVE_PLUGIN_FILES.map(name => `profiles/${ADMIN_SPACE}/plugins/${COMMUNITY_ARCHIVE_PLUGIN}/${name}`),
      `profiles/${ADMIN_SPACE}/.env`,
      `profiles/${ADMIN_SPACE}/SOUL.md`,
      `profiles/${ADMIN_SPACE}/config.yaml`,
      ...ADMIN_SKILLS.map(name => `profiles/${ADMIN_SPACE}/skills/${name}/SKILL.md`),
      'skills/community-admin/SKILL.md',
      'skills/community-bootstrap/SKILL.md'
    ].sort())
  })

  it('the SHARED space gets only the scoped archive facade; an ISOLATED space stays without archive access', () => {
    const shared = yaml.load(gen()[`profiles/${SHARED_SPACE}/config.yaml`])
    expect(shared.platform_toolsets.whatsapp).toEqual([...SHARED_TOOLSET])
    expect(shared.platform_toolsets.whatsapp).toContain(COMMUNITY_ARCHIVE_TOOL)
    expect(shared.platform_toolsets.whatsapp).not.toContain('session_search')
    expect(shared.agent.disabled_toolsets).toContain('session_search')
    expect(shared.memory.write_approval).toBe(true)
    expect(shared.skills.write_approval).toBe(true)
    expect(shared.plugins.enabled).toContain(COMMUNITY_ARCHIVE_PLUGIN)
    expect(shared.plugins.disabled).not.toContain(COMMUNITY_ARCHIVE_PLUGIN)
    expect(shared.plugins.entries[COMMUNITY_ARCHIVE_PLUGIN].allow_tool_override).toBe(false)

    const isolated = yaml.load(gen()['profiles/emergency/config.yaml'])
    expect(isolated.platform_toolsets.whatsapp).toEqual([...GROUP_TOOLSET])
    expect(isolated.platform_toolsets.whatsapp).not.toContain(COMMUNITY_ARCHIVE_TOOL)
    expect(isolated.platform_toolsets.whatsapp).not.toContain('session_search')
    expect(isolated.agent.disabled_toolsets).toContain('session_search')
    expect(isolated.memory.write_approval).toBe(true)
    expect(isolated.skills.write_approval).toBe(true)
    expect(isolated.plugins.enabled).not.toContain(COMMUNITY_ARCHIVE_PLUGIN)
    expect(isolated.plugins.disabled).toContain(COMMUNITY_ARCHIVE_PLUGIN)
    expect(isolated.plugins.entries[COMMUNITY_ARCHIVE_PLUGIN]).toBeUndefined()
  })

  it('registers the archive plugin inside a fresh shared profile on first boot, never inside an isolated profile', () => {
    const artifacts = gen()
    for (const name of COMMUNITY_ARCHIVE_PLUGIN_FILES) {
      expect(artifacts[`profiles/${SHARED_SPACE}/plugins/${COMMUNITY_ARCHIVE_PLUGIN}/${name}`])
        .toBe(artifacts[`plugins/${COMMUNITY_ARCHIVE_PLUGIN}/${name}`])
      expect(artifacts[`profiles/emergency/plugins/${COMMUNITY_ARCHIVE_PLUGIN}/${name}`]).toBeUndefined()
    }
  })

  it('the fenced toolsets expose no config/file/terminal capability (hard audience boundary)', () => {
    for (const banned of ['terminal', 'file', 'code_execution', 'delegation', 'cronjob', 'memory']) {
      expect(GROUP_TOOLSET).not.toContain(banned)
      expect(SHARED_TOOLSET).not.toContain(banned)
    }
    // The shared toolset is exactly the fence + scoped archive, nothing more.
    expect(SHARED_TOOLSET).toEqual([...GROUP_TOOLSET, COMMUNITY_ARCHIVE_TOOL])
  })

  it('writes a server-owned archive policy with shared public groups only', () => {
    expect(buildArchivePolicy(contract())).toEqual({
      version: 1,
      groups: [{ id: '120363000000000001@g.us', name: 'קבוצת היישוב הראשית' }]
    })
    expect(JSON.parse(gen()['community/archive-policy.json'])).toEqual(buildArchivePolicy(contract()))
  })

  // Live finding 2026-08-16: WhatsApp DMs present chat_id as `<lid>@lid` and
  // route matching is an exact string compare (profile_routing.py:102, no LID
  // resolution) — the admin's DM fell into the DEFAULT profile. When the
  // engine's own lid-mapping file knows the admin's LID, every surface must
  // carry BOTH identity forms.
  describe('admin LID identities (adminLids)', () => {
    const LIDS = { '972501234567': '160868067200001' }

    it('emits a second admin-DM route in LID form when the mapping is known', () => {
      const routes = buildRoutes(contract(), LIDS)
      expect(routes).toContainEqual({
        name: 'admin-dm-lid-972501234567',
        platform: 'whatsapp',
        chat_id: '160868067200001@lid',
        profile: ADMIN_SPACE
      })
      // The unmapped admin keeps only the classic route.
      expect(routes.filter(r => r.name.includes('972529876543'))).toHaveLength(1)
      // Without mappings nothing changes.
      expect(buildRoutes(contract()).filter(r => r.chat_id?.endsWith('@lid'))).toHaveLength(0)
    })

    it('grants the LID chat id in the egress gate and the admin env allowlist', () => {
      const policy = buildEgressPolicy(contract(), undefined, LIDS)
      expect(policy.community_sources).toContainEqual({ id: '160868067200001@lid', type: 'dm', platform: 'whatsapp' })
      const env = spaceOwnedEnv({ slug: ADMIN_SPACE, admin: true, shared: false, groups: [] }, contract(), LIDS)
      expect(env.WHATSAPP_ALLOWED_USERS).toBe('972501234567,160868067200001,972529876543')
    })
  })

  // Live finding 2026-08-16 (gateway -vv): under multiplex the engine reads
  // platform gate env vars ONLY from the routed profile's own .env scope, and
  // triggered group messages carry no user_id — so each space profile MUST
  // ship WHATSAPP_GROUP_ALLOWED_USERS (chat-scoped authz) in its own .env or
  // every routed group turn dies as "Ignoring message with no user_id".
  describe('per-space profile .env (routed-turn authorization scope)', () => {
    it('the ROOT .env carries ALL contract group JIDs (intake authz runs before the profile scope exists)', () => {
      expect(gen()['.env']).toContain(
        'WHATSAPP_GROUP_ALLOWED_USERS=120363000000000001@g.us,120363000000000002@g.us'
      )
    })

    it('group spaces get exactly their contract group JIDs as WHATSAPP_GROUP_ALLOWED_USERS', () => {
      const artifacts = gen()
      expect(artifacts[`profiles/${SHARED_SPACE}/.env`]).toContain(
        'WHATSAPP_GROUP_ALLOWED_USERS=120363000000000001@g.us'
      )
      expect(artifacts['profiles/emergency/.env']).toContain(
        'WHATSAPP_GROUP_ALLOWED_USERS=120363000000000002@g.us'
      )
      // dms defaults to 'admins': the shared space gets NO sender allowlist.
      expect(artifacts[`profiles/${SHARED_SPACE}/.env`]).not.toContain('WHATSAPP_ALLOWED_USERS=')
    })

    it('the admin space allowlists exactly the contract admins for its routed DMs', () => {
      const env = gen()[`profiles/${ADMIN_SPACE}/.env`]
      expect(env).toContain('WHATSAPP_ALLOWED_USERS=972501234567,972529876543')
      expect(env).not.toContain('WHATSAPP_GROUP_ALLOWED_USERS')
    })

    it("dms 'open' opens the RESIDENTS space's sender gate and leaves every group space chat-scoped", () => {
      const open = { ...contract(), dmMode: 'open' }
      // The DM audience belongs to the residents space, so no group profile's
      // sender gate is widened for it.
      expect(spaceOwnedEnv({ slug: SHARED_SPACE, shared: true, admin: false, groups: contract().groups.slice(0, 1) }, open))
        .toEqual({ WHATSAPP_GROUP_ALLOWED_USERS: '120363000000000001@g.us' })
      // The residents space cannot list its senders by definition — the
      // native dm_policy already gated intake.
      expect(spaceOwnedEnv({ slug: RESIDENT_SPACE, shared: false, admin: false, resident: true, groups: [] }, open))
        .toEqual({ WHATSAPP_ALLOWED_USERS: '*' })
    })

    it('preserves pre-existing profile .env content and rewrites only owned keys', () => {
      const artifacts = gen({
        readProfileEnvText: slug =>
          slug === SHARED_SPACE ? '# comment\nOPENAI_API_KEY=sk-x\nWHATSAPP_GROUP_ALLOWED_USERS=stale@g.us\n' : undefined
      })
      const env = artifacts[`profiles/${SHARED_SPACE}/.env`]
      expect(env).toContain('# comment')
      expect(env).toContain('OPENAI_API_KEY=sk-x')
      expect(env).toContain('WHATSAPP_GROUP_ALLOWED_USERS=120363000000000001@g.us')
      expect(env).not.toContain('stale@g.us')
    })
  })

  // Live finding 2026-08-16: the companion business-whatsapp-policy gate held
  // ALL WhatsApp egress read-only, so the pilot group's first triggered reply
  // was skipped at dispatch. Community turns share the gateway process — the
  // contract must authorize its chats in that gate too.
  describe('egress policy (business-whatsapp-policy gate authorization)', () => {
    it('grants exactly the contract groups + admin DMs as generator-owned community_sources', () => {
      const policy = buildEgressPolicy(contract(), undefined)
      expect(policy.community_sources).toEqual([
        { id: '120363000000000001@g.us', type: 'group', platform: 'whatsapp' },
        { id: '120363000000000002@g.us', type: 'group', platform: 'whatsapp' },
        { id: '972501234567@s.whatsapp.net', type: 'dm', platform: 'whatsapp' },
        { id: '972529876543@s.whatsapp.net', type: 'dm', platform: 'whatsapp' }
      ])
      // Absent file → the plugin's own fail-closed defaults for the OWNER surface.
      expect(policy.mode).toBe('read_only')
      expect(policy.behavior).toBe('monitor')
      expect(policy.sources).toEqual([])
    })

    it('preserves the owner surface verbatim and only replaces community_sources (fixpoint)', () => {
      const owner = {
        version: 2,
        mode: 'selected_chats',
        behavior: 'assist',
        instructions: 'עסקי',
        reply_chats: ['972501111111'],
        reply_groups: [],
        sources: [{ id: '972501111111@s.whatsapp.net', name: 'לקוח', type: 'dm', platform: 'whatsapp' }],
        community_sources: [{ id: 'stale@g.us', type: 'group', platform: 'whatsapp' }]
      }
      const merged = buildEgressPolicy(contract(), JSON.stringify(owner))
      expect(merged.mode).toBe('selected_chats')
      expect(merged.behavior).toBe('assist')
      expect(merged.instructions).toBe('עסקי')
      expect(merged.sources).toEqual(owner.sources)
      expect(merged.community_sources.map(s => s.id)).not.toContain('stale@g.us')
      // Re-running on the merged output is a no-op (fixpoint).
      expect(buildEgressPolicy(contract(), JSON.stringify(merged))).toEqual(merged)
    })

    it('refuses to overwrite an unparseable policy file', () => {
      expect(() => buildEgressPolicy(contract(), 'not json {')).toThrow(/refusing/)
      expect(() => buildEgressPolicy(contract(), '[1,2]')).toThrow(/refusing/)
    })

    it('ships the policy as a generated artifact fed by the existing disk text', () => {
      const artifacts = gen({
        existingEgressPolicyText: JSON.stringify({ version: 2, mode: 'selected_chats', behavior: 'monitor', reply_chats: [], reply_groups: [], sources: [] })
      })
      const parsed = JSON.parse(artifacts['business/whatsapp-policy.json'])
      expect(parsed.mode).toBe('selected_chats')
      expect(parsed.community_sources.length).toBeGreaterThan(0)
    })
  })

  // Pilot group, 2026-08-14: a clarify call parked the turn for 21+ minutes at
  // "iteration 1/500, clarify" and every later message got only an
  // "Interrupting current task" ack — one unanswered prompt took the bot down
  // for the whole group. No timeout exists on that wait.
  it('never gives a GROUP the clarify tool (a blocking prompt hangs a public group), but keeps it for admin DMs', () => {
    expect(GROUP_TOOLSET).not.toContain('clarify')
    expect(SHARED_TOOLSET).not.toContain('clarify')
    expect(ADMIN_TOOLSET).toContain('clarify')
  })

  it('the group persona asks for clarification in plain text instead of opening a poll', () => {
    const soul = gen()[`profiles/${SHARED_SPACE}/SOUL.md`]
    expect(soul).toContain('כמשפט טקסט רגיל')
    expect(soul).toContain('לפני שאתה שואל שאלת הבהרה')
  })

  it('unions the knowledge packs of ALL shared-space member groups into the village profile', () => {
    const c = contract()
    c.groups[1].isolated = false // emergency joins the shared space
    c.groups[1].tone = 'default' // (validation would demand tone coherence)
    const artifacts = generateArtifacts(c, {
      readKnowledgeSource: readSource,
      readAdminSkillTemplate: name => adminTemplates[name],
      readCommunityPluginFile,
      deployPaths
    })
    expect(artifacts[`profiles/${SHARED_SPACE}/skills/general/SKILL.md`]).toBeDefined()
    expect(artifacts[`profiles/${SHARED_SPACE}/skills/emergency/SKILL.md`]).toBeDefined()
    expect(artifacts['profiles/emergency/config.yaml']).toBeUndefined() // no per-group profile
    expect(artifacts['profiles/main/config.yaml']).toBeUndefined()
  })

  it('profile config merges over an existing SPACE profile config, preserving non-owned keys', () => {
    const merged = yaml.load(
      gen({
        readProfileConfigText: space =>
          space === SHARED_SPACE
            ? yaml.dump({ agent: { max_turns: 42 }, platform_toolsets: { whatsapp: ['terminal'] } })
            : undefined
      })[`profiles/${SHARED_SPACE}/config.yaml`]
    )
    expect(merged.agent.max_turns).toBe(42) // non-owned: preserved
    expect(merged.agent.disabled_toolsets).toContain('session_search')
    expect(merged.platform_toolsets.whatsapp).toEqual([...SHARED_TOOLSET]) // owned: rewritten
  })

  // Live on the pilot 2026-08-14: a routed group turn resolves its model from
  // the PROFILE home (multiplex overrides get_hermes_home()), so a profile
  // carrying its own stale model silently answers with the wrong one — and a
  // profile carrying none dies with `HTTP 400: No models provided`.
  it('OVERWRITES a per-space model block with the ROOT config model (both name and provider travel)', () => {
    const merged = yaml.load(
      gen({
        existingConfigText: yaml.dump({ model: { default: 'gpt-5.6-sol', provider: 'openai-codex' } }),
        readProfileConfigText: space =>
          space === SHARED_SPACE ? yaml.dump({ model: { default: 'stale-model' } }) : undefined
      })[`profiles/${SHARED_SPACE}/config.yaml`]
    )
    expect(merged.model).toEqual({ default: 'gpt-5.6-sol', provider: 'openai-codex' })
  })

  it('drops a per-space model block when the ROOT config has none (no model is honest; a stale one is not)', () => {
    const merged = yaml.load(
      gen({
        readProfileConfigText: space =>
          space === SHARED_SPACE ? yaml.dump({ model: { default: 'stale-model' } }) : undefined
      })[`profiles/${SHARED_SPACE}/config.yaml`]
    )
    expect(merged.model).toBeUndefined()
  })

  it('buildProfileConfig refuses a non-mapping existing profile config', () => {
    expect(() => buildProfileConfig('- nope\n')).toThrow(/not a YAML mapping/)
  })

  it('the SHARED SOUL.md represents the whole community: lists member groups + purposes, teaches shared memory', () => {
    const soul = gen()[`profiles/${SHARED_SPACE}/SOUL.md`]
    expect(soul).toContain('כפר הדגמה')
    expect(soul).toContain('תכלס')
    // Member group listed with its purpose…
    expect(soul).toContain('קבוצת היישוב הראשית')
    expect(soul).toContain('שאלות כלליות, מידע יישובי')
    // …but the ISOLATED group is NOT part of the shared persona.
    expect(soul).not.toContain('צח"י')
    // Shared-memory model + the no-invention anchor.
    expect(soul).toContain('זיכרון קהילתי משותף')
    expect(soul).toContain('community_archive')
    expect(soul).toContain('ראיות לא מאומתות')
    expect(soul).toContain('אל תמציא')
  })

  it('the ISOLATED space keeps the per-group SOUL (strict tone) and never the shared-memory section', () => {
    const strict = gen()['profiles/emergency/SOUL.md']
    const shared = gen()[`profiles/${SHARED_SPACE}/SOUL.md`]
    expect(strict).not.toBe(shared)
    expect(strict).toContain('צח"י')
    expect(strict).toContain('בכל ספק')
    expect(strict).toContain('משפט אחד או שניים')
    expect(strict).not.toContain('זיכרון קהילתי משותף')
    expect(shared).toContain('1–4 משפטים')
    expect(shared).not.toContain('משפט אחד או שניים')
  })

  it('a uniformly strict shared space renders the strict register in the shared SOUL', () => {
    const soul = renderSharedSoul({
      communityName: 'x',
      wakeWord: 'y',
      groups: [{ name: 'a', purpose: 'p' }],
      tone: 'strict'
    })
    expect(soul).toContain('משפט אחד או שניים')
  })

  it('renderSoul and renderSharedSoul are deterministic', () => {
    const args = { communityName: 'x', wakeWord: 'y', group: contract().groups[0] }
    expect(renderSoul(args)).toBe(renderSoul(args))
    const sharedArgs = { communityName: 'x', wakeWord: 'y', groups: contract().groups, tone: 'default' }
    expect(renderSharedSoul(sharedArgs)).toBe(renderSharedSoul(sharedArgs))
  })

  it('knowledge skills carry valid frontmatter and the source content', () => {
    const skill = gen()[`profiles/${SHARED_SPACE}/skills/general/SKILL.md`]
    expect(skill.startsWith('---\nname: general\ndescription: ')).toBe(true)
    const [, frontmatter] = skill.split('---\n')
    const fm = yaml.load(frontmatter)
    expect(fm.name).toBe('general')
    expect(fm.description).toBe('מידע יישובי כללי')
    expect(fm.description.length).toBeLessThanOrEqual(60)
    expect(skill).toContain('שעות מזכירות: 08:00-12:00')
  })

  it('a pack declared in several spaces renders IDENTICAL bytes into each', () => {
    const a = gen()[`profiles/${SHARED_SPACE}/skills/general/SKILL.md`]
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
  it('installs every ADMIN_SKILLS entry under skills/ (default profile), never under space profiles', () => {
    const artifacts = gen()
    for (const name of ADMIN_SKILLS) {
      expect(artifacts[`skills/${name}/SKILL.md`]).toBeDefined()
      for (const space of [SHARED_SPACE, 'emergency']) {
        expect(artifacts[`profiles/${space}/skills/${name}/SKILL.md`]).toBeUndefined()
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

// The `dms: open` capability is DORMANT: a contract that does not opt in must
// produce byte-identical output to the day before this feature existed, and an
// opted-in contract must produce a residents space that is fenced as tightly
// as an isolated group.
describe("dms 'open' — the residents DM space (§2.2)", () => {
  const openContract = () => ({ ...contract(), dmMode: 'open' })
  const genOpen = (overrides = {}) =>
    generateArtifacts(openContract(), {
      readKnowledgeSource: readSource,
      readAdminSkillTemplate: name => adminTemplates[name],
      readCommunityPluginFile,
      deployPaths,
      ...overrides
    })

  it('appends a residents space carrying the PUBLIC knowledge union only', () => {
    const spaces = contractSpaces(openContract())
    expect(spaces.map(s => s.slug)).toEqual([SHARED_SPACE, 'emergency', ADMIN_SPACE, RESIDENT_SPACE])
    const residents = spaces.at(-1)
    expect(residents.resident).toBe(true)
    expect(residents.groups).toEqual([])
    // 'emergency' is isolated — its pack never travels into a private chat.
    expect(residents.knowledge).toEqual(['general'])
  })

  it('routes unclaimed DMs to it with a platform-only catch-all that cannot outrank an exact route', () => {
    const routes = buildRoutes(openContract())
    const catchAll = routes.at(-1)
    expect(catchAll).toEqual({ name: 'residents-dm-catchall', platform: 'whatsapp', profile: RESIDENT_SPACE })
    // No chat_id (and no guild/thread) — specificity 0, so the engine's
    // most-specific-first sort keeps every exact route above it winning.
    expect('chat_id' in catchAll).toBe(false)
    expect(routes.filter(r => r.profile === RESIDENT_SPACE)).toHaveLength(1)
    // The exact routes are untouched: same set, same order as under 'admins'.
    expect(routes.slice(0, -1)).toEqual(buildRoutes(contract()))
  })

  it('fences the residents profile exactly like an isolated group — no archive, no session_search', () => {
    const cfg = yaml.load(genOpen()[`profiles/${RESIDENT_SPACE}/config.yaml`])
    expect(cfg.platform_toolsets.whatsapp).toEqual([...RESIDENT_TOOLSET])
    expect(RESIDENT_TOOLSET).toEqual([...GROUP_TOOLSET])
    expect(cfg.platform_toolsets.whatsapp).not.toContain(COMMUNITY_ARCHIVE_TOOL)
    expect(cfg.agent.disabled_toolsets).toContain('session_search')
    expect(cfg.plugins.enabled).not.toContain(COMMUNITY_ARCHIVE_PLUGIN)
    expect(cfg.plugins.disabled).toContain(COMMUNITY_ARCHIVE_PLUGIN)
    expect(cfg.memory.write_approval).toBe(true)
    expect(cfg.skills.write_approval).toBe(true)
  })

  it('gives it the private-chat persona, the public knowledge skills and no management skill', () => {
    const artifacts = genOpen()
    expect(artifacts[`profiles/${RESIDENT_SPACE}/SOUL.md`]).toBe(
      renderResidentSoul({ communityName: contract().name, wakeWord: contract().wakeWord })
    )
    expect(artifacts[`profiles/${RESIDENT_SPACE}/skills/general/SKILL.md`]).toBeDefined()
    expect(artifacts[`profiles/${RESIDENT_SPACE}/skills/emergency/SKILL.md`]).toBeUndefined()
    for (const name of ADMIN_SKILLS) {
      expect(artifacts[`profiles/${RESIDENT_SPACE}/skills/${name}/SKILL.md`]).toBeUndefined()
    }
    for (const name of COMMUNITY_ARCHIVE_PLUGIN_FILES) {
      expect(artifacts[`profiles/${RESIDENT_SPACE}/plugins/${COMMUNITY_ARCHIVE_PLUGIN}/${name}`]).toBeUndefined()
    }
    expect(artifacts[`profiles/${RESIDENT_SPACE}/.env`]).toContain('WHATSAPP_ALLOWED_USERS=*')
    expect(artifacts[`profiles/${RESIDENT_SPACE}/.env`]).not.toContain('WHATSAPP_GROUP_ALLOWED_USERS')
  })

  it('grants the egress gate a DM SHAPE (unknown senders are unlistable) without touching the owner surface', () => {
    const policy = buildEgressPolicy(openContract(), undefined)
    expect(policy.community_dm_open_platforms).toEqual([...DM_OPEN_PLATFORMS])
    expect(policy.community_dm_open_platforms).toEqual(['whatsapp'])
    // The enumerated grants are unchanged by the shape grant.
    expect(policy.community_sources).toEqual(buildEgressPolicy(contract(), undefined).community_sources)
    expect(policy.mode).toBe('read_only')
    expect(policy.behavior).toBe('monitor')
    expect(policy.sources).toEqual([])
    // Fixpoint over the owner's own file.
    const owner = { version: 2, mode: 'selected_chats', behavior: 'assist', reply_chats: [], reply_groups: [], sources: [] }
    const merged = buildEgressPolicy(openContract(), JSON.stringify(owner))
    expect(merged.mode).toBe('selected_chats')
    expect(buildEgressPolicy(openContract(), JSON.stringify(merged))).toEqual(merged)
  })

  it('RECLAIMS the open-DM surface when the contract goes back to admins (a grant never outlives its contract)', () => {
    const opened = genOpen()
    // Downgrade: feed the OPEN output back in as the state on disk.
    const closed = gen({
      existingConfigText: opened['config.yaml'],
      existingEgressPolicyText: opened['business/whatsapp-policy.json']
    })
    const cfg = yaml.load(closed['config.yaml'])
    expect(cfg.profile_routes.some(r => r.profile === RESIDENT_SPACE)).toBe(false)
    expect(JSON.parse(closed['business/whatsapp-policy.json']).community_dm_open_platforms).toBeUndefined()
  })

  it("emits NOTHING of the residents surface under the default dms 'admins' (dormant)", () => {
    const artifacts = gen()
    expect(Object.keys(artifacts).filter(p => p.includes(RESIDENT_SPACE))).toEqual([])
    expect(contractSpaces(contract()).some(s => s.resident)).toBe(false)
    expect(buildRoutes(contract()).some(r => !('chat_id' in r))).toBe(false)
    expect(buildEgressPolicy(contract(), undefined).community_dm_open_platforms).toBeUndefined()
    expect(JSON.parse(artifacts['business/whatsapp-policy.json']).community_dm_open_platforms).toBeUndefined()
  })

  it("an explicit dms 'admins' is byte-identical to a contract that never mentioned dms", () => {
    const explicit = generateArtifacts({ ...contract(), dmMode: 'admins' }, {
      readKnowledgeSource: readSource,
      readAdminSkillTemplate: name => adminTemplates[name],
      readCommunityPluginFile,
      deployPaths
    })
    expect(explicit).toEqual(gen())
  })

  it('the ONLY delta between admins and open is the residents surface plus the two owned keys', () => {
    const closed = gen()
    const opened = genOpen()
    // Nothing an 'admins' deployment already has disappears...
    expect(Object.keys(closed).filter(p => !(p in opened))).toEqual([])
    // ...every NEW path belongs to the residents profile...
    expect(Object.keys(opened).filter(p => !(p in closed)).map(p => p.split('/').slice(0, 2).join('/')))
      .toEqual(expect.arrayContaining([`profiles/${RESIDENT_SPACE}`]))
    expect(Object.keys(opened).filter(p => !(p in closed) && !p.startsWith(`profiles/${RESIDENT_SPACE}/`))).toEqual([])
    // ...and exactly two shared files change: the appended catch-all route and
    // the DM-shape grant. The village profile, its SOUL, its .env and every
    // group fence stay byte-identical.
    expect(Object.keys(closed).filter(p => closed[p] !== opened[p]).sort())
      .toEqual(['business/whatsapp-policy.json', 'config.yaml'])
  })

  it('is a FIXPOINT: re-generating over its own output changes nothing', () => {
    const first = genOpen()
    const second = genOpen({
      existingConfigText: first['config.yaml'],
      existingEnvText: first['.env'],
      existingEgressPolicyText: first['business/whatsapp-policy.json'],
      readProfileConfigText: slug => first[`profiles/${slug}/config.yaml`],
      readProfileEnvText: slug => first[`profiles/${slug}/.env`]
    })
    expect(second).toEqual(first)
  })
})
