import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import { generateArtifacts } from './generate.mjs'
import { ADMIN_SPACE } from './contract.mjs'
import {
  GROUP_TOOLSET,
  OWNED_ENV,
  SHARED_SPACE,
  SHARED_TOOLSET,
  contentChecksum,
  diffOwnedViews,
  effectiveEnvOwnedView,
  effectiveOwnedView,
  effectiveProfileOwnedView,
  expectedEnvOwnedView,
  expectedOwnedView,
  expectedProfileOwnedView,
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
        knowledge: []
      }
    ],
    knowledge: { general: { source: 'knowledge/general.md', description: 'מידע יישובי כללי' } }
  }
}

const sources = { 'knowledge/general.md': '# ידע\nתוכן\n' }
const readCommunityPluginFile = name => `# runtime fixture: ${name}\n`
const adminTemplates = {
  'community-bootstrap': '---\nname: community-bootstrap\ndescription: "הקמה"\n---\n\nבית: {{HOME_DIR}} חוזה: {{CONTRACT_PATH}} כלי: {{GENERATE_CLI}} {{PROVISION_CLI}} שורש: {{INSTALL_ROOT}}\n',
  'community-admin': '---\nname: community-admin\ndescription: "ניהול"\n---\n\nnode "{{GENERATE_CLI}}" verify --contract "{{CONTRACT_PATH}}" --home "{{HOME_DIR}}" ({{PROVISION_CLI}} {{INSTALL_ROOT}})\n'
}
const deployPaths = {
  HOME_DIR: 'C:\\Community\\home',
  CONTRACT_PATH: 'C:\\Community\\community.yaml',
  INSTALL_ROOT: 'C:\\Community',
  GENERATE_CLI: 'C:\\App\\scripts\\community-generate.mjs',
  PROVISION_CLI: 'C:\\App\\scripts\\community-provision.mjs'
}
const gen = () =>
  generateArtifacts(contract(), {
    readKnowledgeSource: p => sources[p],
    readAdminSkillTemplate: name => adminTemplates[name],
    readCommunityPluginFile,
    deployPaths
  })

// A fake home: relPath → content (null = absent).
const homeReader = files => relPath => (relPath in files ? files[relPath] : null)

describe('verifyArtifacts — clean home', () => {
  it('verifies a freshly generated home as ok on every artifact', () => {
    const artifacts = gen()
    const report = verifyArtifacts(contract(), artifacts, { readFile: homeReader({ ...artifacts }) })
    expect(report.ok).toBe(true)
    expect(report.artifacts.map(a => a.status)).toEqual(report.artifacts.map(() => 'ok'))
    expect(report.artifacts.map(a => a.path)).toContain('config.yaml')
    expect(report.artifacts.map(a => a.path)).toContain('.env')
    expect(report.artifacts.map(a => a.path)).toContain(`profiles/${SHARED_SPACE}/config.yaml`)
    expect(report.artifacts.map(a => a.path)).toContain(`profiles/${SHARED_SPACE}/skills/general/SKILL.md`)
    expect(report.artifacts.map(a => a.path)).toContain('profiles/emergency/config.yaml')
    expect(report.artifacts.map(a => a.path)).toContain('skills/community-admin/SKILL.md')
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
          agent: parsed.agent,
          plugins: parsed.plugins,
          skills: parsed.skills,
          memory: parsed.memory,
          whatsapp: {
            ...parsed.whatsapp,
            group_allow_from: [...parsed.whatsapp.group_allow_from].reverse(),
            allow_from: [...parsed.whatsapp.allow_from].reverse()
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

  it('accepts an owner-widened DM allowlist but flags a REMOVED community admin (fixpoint)', () => {
    const artifacts = gen()
    // Owner added their own DM contact — additive single-home semantics: not drift.
    const widened = yaml.load(artifacts['config.yaml'])
    widened.whatsapp.allow_from = [...widened.whatsapp.allow_from, '972000000000']
    const widenedHome = { ...artifacts, 'config.yaml': yaml.dump(widened) }
    expect(
      verifyArtifacts(contract(), artifacts, { readFile: homeReader(widenedHome) }).artifacts.find(
        a => a.path === 'config.yaml'
      ).status
    ).toBe('ok')
    // A community admin dropped from the allowlist breaks the fixpoint: drift.
    const dropped = yaml.load(artifacts['config.yaml'])
    dropped.whatsapp.allow_from = dropped.whatsapp.allow_from.filter(v => v !== contract().admins[0])
    const droppedHome = { ...artifacts, 'config.yaml': yaml.dump(dropped) }
    const entry = verifyArtifacts(contract(), artifacts, { readFile: homeReader(droppedHome) }).artifacts.find(
      a => a.path === 'config.yaml'
    )
    expect(entry.status).toBe('drift')
    expect(entry.detail).toContain('whatsapp.allow_from')
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

describe('verifyArtifacts — space profile configs (per-space fence is an owned gate, §6.1 + §2.1)', () => {
  it('tolerates an engine rewrite of a profile config (owned VALUES unchanged)', () => {
    const artifacts = gen()
    const parsed = yaml.load(artifacts[`profiles/${SHARED_SPACE}/config.yaml`])
    const rewritten = yaml.dump(
      {
        skills: parsed.skills,
        platform_toolsets: { whatsapp: [...parsed.platform_toolsets.whatsapp].reverse() },
        memory: parsed.memory,
        agent: { ...parsed.agent, max_turns: 42 }, // non-owned engine/operator addition is not drift
        plugins: parsed.plugins
      },
      { sortKeys: false }
    )
    const home = { ...artifacts, [`profiles/${SHARED_SPACE}/config.yaml`]: rewritten }
    const report = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) })
    expect(report.ok, JSON.stringify(report.artifacts, null, 2)).toBe(true)
  })

  // The model block is what a routed turn actually runs on (pilot, 2026-08-14).
  it('flags a space profile whose model block does not mirror the ROOT config', () => {
    const artifacts = gen()
    const root = yaml.load(artifacts['config.yaml'])
    root.model = { default: 'gpt-5.6-sol', provider: 'openai-codex' }
    const home = { ...artifacts, 'config.yaml': yaml.dump(root) }
    const entry = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) }).artifacts.find(
      a => a.path === `profiles/${SHARED_SPACE}/config.yaml`
    )
    expect(entry.status).toBe('drift')
    expect(entry.detail).toContain('model')
  })

  it('accepts a space profile whose model block mirrors the ROOT config', () => {
    const model = { default: 'gpt-5.6-sol', provider: 'openai-codex' }
    const artifacts = generateArtifacts(contract(), {
      readKnowledgeSource: p => sources[p],
      readAdminSkillTemplate: name => adminTemplates[name],
      readCommunityPluginFile,
      deployPaths,
      existingConfigText: yaml.dump({ model })
    })
    expect(yaml.load(artifacts[`profiles/${SHARED_SPACE}/config.yaml`]).model).toEqual(model)
    const report = verifyArtifacts(contract(), artifacts, { readFile: homeReader({ ...artifacts }) })
    expect(report.ok, JSON.stringify(report.artifacts, null, 2)).toBe(true)
  })

  it('flags a widened shared-space toolset as drift (the space would gain terminal/file)', () => {
    const artifacts = gen()
    const parsed = yaml.load(artifacts[`profiles/${SHARED_SPACE}/config.yaml`])
    parsed.platform_toolsets.whatsapp = [...SHARED_TOOLSET, 'terminal']
    const home = { ...artifacts, [`profiles/${SHARED_SPACE}/config.yaml`]: yaml.dump(parsed) }
    const entry = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) }).artifacts.find(
      a => a.path === `profiles/${SHARED_SPACE}/config.yaml`
    )
    expect(entry.status).toBe('drift')
    expect(entry.detail).toContain('platform_toolsets.whatsapp')
  })

  it('flags any raw session_search added to an isolated space as drift', () => {
    const artifacts = gen()
    const parsed = yaml.load(artifacts['profiles/emergency/config.yaml'])
    parsed.platform_toolsets.whatsapp = [...GROUP_TOOLSET, 'session_search']
    const home = { ...artifacts, 'profiles/emergency/config.yaml': yaml.dump(parsed) }
    const entry = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) }).artifacts.find(
      a => a.path === 'profiles/emergency/config.yaml'
    )
    expect(entry.status).toBe('drift')
    expect(entry.detail).toContain('platform_toolsets.whatsapp')
  })

  it('flags the scoped archive removed from the shared space as drift', () => {
    const artifacts = gen()
    const parsed = yaml.load(artifacts[`profiles/${SHARED_SPACE}/config.yaml`])
    parsed.platform_toolsets.whatsapp = [...GROUP_TOOLSET]
    const home = { ...artifacts, [`profiles/${SHARED_SPACE}/config.yaml`]: yaml.dump(parsed) }
    const entry = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) }).artifacts.find(
      a => a.path === `profiles/${SHARED_SPACE}/config.yaml`
    )
    expect(entry.status).toBe('drift')
    expect(entry.detail).toContain('platform_toolsets.whatsapp')
  })

  it('flags any resident slash command added to the public-group allowlist', () => {
    const artifacts = gen()
    const parsed = yaml.load(artifacts['config.yaml'])
    parsed.whatsapp.group_user_allowed_commands = ['help']
    const home = { ...artifacts, 'config.yaml': yaml.dump(parsed) }
    const entry = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) }).artifacts.find(
      a => a.path === 'config.yaml'
    )
    expect(entry.status).toBe('drift')
    expect(entry.detail).toContain('whatsapp.group_user_allowed_commands')
  })

  it('flags a shared profile whose local archive plugin registration is removed', () => {
    const artifacts = gen()
    const parsed = yaml.load(artifacts[`profiles/${SHARED_SPACE}/config.yaml`])
    parsed.plugins.enabled = []
    const home = { ...artifacts, [`profiles/${SHARED_SPACE}/config.yaml`]: yaml.dump(parsed) }
    const entry = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) }).artifacts.find(
      a => a.path === `profiles/${SHARED_SPACE}/config.yaml`
    )
    expect(entry.status).toBe('drift')
    expect(entry.detail).toContain('plugins.community-archive.enabled')
  })

  it('reports a deleted profile config as missing (the fence would silently open)', () => {
    const artifacts = gen()
    const home = Object.fromEntries(
      Object.entries(artifacts).filter(([p]) => p !== 'profiles/emergency/config.yaml')
    )
    const entry = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) }).artifacts.find(
      a => a.path === 'profiles/emergency/config.yaml'
    )
    expect(entry.status).toBe('missing')
  })
})

describe('verifyArtifacts — .env (owned keys only)', () => {
  it('tolerates engine-appended entries (pairing writes are not drift)', () => {
    const artifacts = gen()
    const home = { ...artifacts, '.env': artifacts['.env'] + 'OPENAI_API_KEY=sk-live\n# engine note\n' }
    const report = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) })
    expect(report.ok).toBe(true)
  })

  it('flags a narrowed bridge allowlist (residents would be dropped at the bridge)', () => {
    const artifacts = gen()
    const home = { ...artifacts, '.env': 'WHATSAPP_ENABLED=true\nWHATSAPP_MODE=bot\nWHATSAPP_ALLOWED_USERS=972501234567\n' }
    const entry = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) }).artifacts.find(
      a => a.path === '.env'
    )
    expect(entry.status).toBe('drift')
    expect(entry.detail).toContain('WHATSAPP_ALLOWED_USERS')
  })

  it('flags a mode flip back to self-chat', () => {
    const artifacts = gen()
    const home = { ...artifacts, '.env': 'WHATSAPP_ENABLED=true\nWHATSAPP_MODE=self-chat\nWHATSAPP_ALLOWED_USERS=*\n' }
    const entry = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) }).artifacts.find(
      a => a.path === '.env'
    )
    expect(entry.status).toBe('drift')
    expect(entry.detail).toContain('WHATSAPP_MODE')
  })

  it('reports a deleted .env as missing', () => {
    const artifacts = gen()
    const home = Object.fromEntries(Object.entries(artifacts).filter(([p]) => p !== '.env'))
    const entry = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) }).artifacts.find(
      a => a.path === '.env'
    )
    expect(entry.status).toBe('missing')
  })

  it('effectiveEnvOwnedView: last occurrence wins, quotes stripped, non-owned ignored', () => {
    const view = effectiveEnvOwnedView('WHATSAPP_MODE="self-chat"\nOTHER=x\nWHATSAPP_MODE=\'bot\'\nWHATSAPP_ENABLED=true\nWHATSAPP_ALLOWED_USERS=*\n')
    expect(view).toEqual(expectedEnvOwnedView())
    expect(expectedEnvOwnedView()).toEqual({ ...OWNED_ENV })
  })
})

describe('verifyArtifacts — text artifacts by checksum', () => {
  it('flags an edited SOUL.md as drift', () => {
    const artifacts = gen()
    const soulPath = `profiles/${SHARED_SPACE}/SOUL.md`
    const home = { ...artifacts, [soulPath]: artifacts[soulPath] + '\nעריכה ידנית\n' }
    const report = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) })
    const entry = report.artifacts.find(a => a.path === soulPath)
    expect(entry.status).toBe('drift')
    expect(report.ok).toBe(false)
  })

  it('flags an edited INSTALLED admin skill as drift (the shipped asset is authoritative)', () => {
    const artifacts = gen()
    const home = {
      ...artifacts,
      'skills/community-admin/SKILL.md': artifacts['skills/community-admin/SKILL.md'].replace('verify', 'destroy')
    }
    const entry = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) }).artifacts.find(
      a => a.path === 'skills/community-admin/SKILL.md'
    )
    expect(entry.status).toBe('drift')
  })

  it('reports a deleted knowledge skill as missing', () => {
    const artifacts = gen()
    const skillPath = `profiles/${SHARED_SPACE}/skills/general/SKILL.md`
    const home = Object.fromEntries(Object.entries(artifacts).filter(([p]) => p !== skillPath))
    const entry = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) }).artifacts.find(
      a => a.path === skillPath
    )
    expect(entry.status).toBe('missing')
  })

  it('tolerates CRLF line endings on disk (Windows checkout of a generated file)', () => {
    const artifacts = gen()
    const soulPath = `profiles/${SHARED_SPACE}/SOUL.md`
    const home = { ...artifacts, [soulPath]: artifacts[soulPath].replace(/\n/g, '\r\n') }
    const entry = verifyArtifacts(contract(), artifacts, { readFile: homeReader(home) }).artifacts.find(
      a => a.path === soulPath
    )
    expect(entry.status).toBe('ok')
  })

  it('contentChecksum normalizes CRLF and is stable', () => {
    expect(contentChecksum('a\r\nb')).toBe(contentChecksum('a\nb'))
    expect(contentChecksum('a')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('effective owned view', () => {
  it('expectedOwnedView is derived from the contract alone (routes target SPACES)', () => {
    const view = expectedOwnedView(contract())
    expect(view['gateway.multiplex_profiles']).toBe(true)
    expect(view['whatsapp.dm_policy']).toBe('allowlist')
    expect(view['whatsapp.allow_from']).toEqual(['972501234567'])
    expect([...new Set(view.profile_routes.map(r => r.profile))].sort()).toEqual([ADMIN_SPACE, 'emergency', SHARED_SPACE])
  })

  it('expectedProfileOwnedView pins the PER-SPACE toolset + write approvals', () => {
    const isolated = expectedProfileOwnedView('emergency')
    expect(isolated['platform_toolsets.whatsapp']).toEqual([...GROUP_TOOLSET].sort())
    expect(isolated['memory.write_approval']).toBe(true)
    expect(isolated['skills.write_approval']).toBe(true)
    const shared = expectedProfileOwnedView(SHARED_SPACE)
    expect(shared['platform_toolsets.whatsapp']).toEqual([...SHARED_TOOLSET].sort())
    expect(shared['platform_toolsets.whatsapp']).toContain('community_archive')
    expect(shared['platform_toolsets.whatsapp']).not.toContain('session_search')
    expect(effectiveProfileOwnedView(undefined)['memory.write_approval']).toBe(false)
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
