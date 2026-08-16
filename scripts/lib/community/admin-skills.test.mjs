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

      it('carries the fail-closed internal instructions in Hebrew', () => {
        const text = template()
        expect(text).toContain('אל תמציא') // never invent JIDs/numbers
        expect(text).toContain('verify') // always verify internally
        expect(text).toContain('אישור') // confirm before writing
      })
    })
  }

  it('keeps the bridge-log JID fallback internally but never asks the user for an id', () => {
    const text = readTemplate('community-bootstrap')
    expect(text).toContain('bridge.log')
    expect(text).toContain('@g\\.us')
    // The honest limitation: on a running deployment (bridge opened with *),
    // unknown-group messages leave no log trace — discovery needs the window.
    expect(text).toContain('להיבלע בשקט')
    expect(text).toContain('לעולם אל תבקש ממנו JID')
    expect(text).toContain('אל תחשוף למשתמש')
  })

  it('admin skill frames the CLI as the RECOMMENDED path, not a prohibition (hard boundary is the toolset)', () => {
    const text = readTemplate('community-admin')
    expect(text).toContain('המומלץ')
    expect(text).toContain('סוכן מלא')
  })

  it('both skills expose a conversation, not the deployment machinery', () => {
    for (const name of ADMIN_SKILLS) {
      const text = readTemplate(name)
      expect(text).toMatch(/שאלה (?:קצרה )?אחת|שאלה אחת קצרה/)
      expect(text).toContain('לא להציג למשתמש')
      expect(text).toMatch(/פלט (?:`verify` גולמי|גולמי של[\s\S]{0,40}`verify`)/)
      expect(text).not.toMatch(/^## שלב \d/m)
    }
    expect(readTemplate('community-bootstrap')).toContain('אל תתחיל בשאלה "מה שם הקהילה?"')
    expect(readTemplate('community-bootstrap')).toContain('מסלול Hermes הרשמי')
  })

  it('both skills keep shared village as the MVP and refuse prompt-only isolation', () => {
    for (const name of ADMIN_SKILLS) {
      const text = readTemplate(name)
      expect(text, `${name} must name the shared space`).toContain('village')
      expect(text, `${name} must warn against profile-only isolation`).toContain('isolated: true')
      expect(text, `${name} must require a separate deployment`).toContain('פריסה נפרדת')
    }
    expect(readTemplate('community-bootstrap')).toContain('אל תחבר את הקבוצה')
    expect(readTemplate('community-admin')).toContain('אינה מצטרפת')
  })
})
