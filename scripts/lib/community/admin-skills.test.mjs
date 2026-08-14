// Validates the SHIPPED admin skill assets (assets/community-skills/) — the
// real product artifacts the generator installs into the default profile.
// These are the operator-facing Hebrew skills; a routing description over 60
// chars would make the skill silently undiscoverable (spec §2 fact 9), so the
// budget is asserted here against the actual files, not just in the renderer.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SKILL_DESCRIPTION_ROUTING_MAX } from './contract.mjs'
import { ADMIN_SKILLS, DEPLOY_PATH_KEYS, parseSkillFrontmatter, renderAdminSkill } from './generate.mjs'

const assetsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'assets', 'community-skills'
)

const deployPaths = {
  HOME_DIR: 'C:\\Community\\home',
  CONTRACT_PATH: 'C:\\Community\\community.yaml',
  INSTALL_ROOT: 'C:\\Community',
  GENERATE_CLI: 'C:\\App\\scripts\\community-generate.mjs',
  PROVISION_CLI: 'C:\\App\\scripts\\community-provision.mjs'
}

const readTemplate = name => readFileSync(path.join(assetsDir, name, 'SKILL.md'), 'utf8')

describe('shipped admin skill assets', () => {
  it('ships exactly the ADMIN_SKILLS set', () => {
    expect([...ADMIN_SKILLS].sort()).toEqual(['community-admin', 'community-bootstrap'])
  })

  for (const name of ADMIN_SKILLS) {
    describe(name, () => {
      const template = () => readTemplate(name)

      it('frontmatter: name matches the directory, description is routable (≤60 chars, single line)', () => {
        const fm = parseSkillFrontmatter(template(), name)
        expect(fm.name).toBe(name)
        expect(typeof fm.description).toBe('string')
        expect(fm.description.trim().length).toBeGreaterThan(0)
        expect(fm.description).not.toMatch(/[\r\n]/)
        expect(
          fm.description.length,
          `description is ${fm.description.length} chars — over the routing budget, the skill would NEVER load`
        ).toBeLessThanOrEqual(SKILL_DESCRIPTION_ROUTING_MAX)
      })

      it('uses only known deployment placeholders, and uses ALL of them', () => {
        const found = new Set([...template().matchAll(/\{\{([A-Z_]+)\}\}/g)].map(m => m[1]))
        for (const key of found) expect(DEPLOY_PATH_KEYS).toContain(key)
        for (const key of DEPLOY_PATH_KEYS) {
          expect([...found], `template must reference {{${key}}} so the agent gets the real path`).toContain(key)
        }
      })

      it('renders cleanly with real deployment paths (no leftover placeholders)', () => {
        const rendered = renderAdminSkill({ name, template: template(), deployPaths })
        expect(rendered).not.toMatch(/\{\{[A-Z_]+\}\}/)
        for (const value of Object.values(deployPaths)) expect(rendered).toContain(value)
        expect(rendered.endsWith('\n')).toBe(true)
        expect(rendered).not.toContain('\r')
      })

      it('carries the fail-closed operator instructions in Hebrew', () => {
        const text = template()
        expect(text).toContain('אל תמציא') // never invent JIDs/numbers
        expect(text).toContain('verify') // always verify and show the output
        expect(text).toContain('אישור') // confirm before writing
      })
    })
  }

  it('bootstrap documents the bridge-log JID discovery trick honestly (incl. the running-deployment gap)', () => {
    const text = readTemplate('community-bootstrap')
    expect(text).toContain('bridge.log')
    expect(text).toContain('@g\\.us')
    // The honest limitation: on a running deployment (bridge opened with *),
    // unknown-group messages leave no log trace — discovery needs the window.
    expect(text).toContain('נבלעות בשקט')
  })

  it('admin skill frames the CLI as the RECOMMENDED path, not a prohibition (hard boundary is the toolset)', () => {
    const text = readTemplate('community-admin')
    expect(text).toContain('המומלץ')
    expect(text).toContain('סוכן מלא')
  })
})
