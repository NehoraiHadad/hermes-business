import type { Skill } from '../../types'
import { buildSkillContent } from '../skill-content'
import { withProfile, type ApiFn } from './core'

export type SkillContent = { name?: string; content?: string; path?: string }

export interface HermesSkillsApi {
  listSkills(): Promise<Skill[]>
  createSkill(name: string, description: string): Promise<unknown>
  // Lower-level skill operations mapped to the real Hermes 0.19.1 routes, used by the
  // durable onboarding receipt: exact-content create/update, content read, and the
  // config-backed enable/disable toggle. There is NO DELETE and NO upsert route — a
  // caller must choose create (POST, 400 if exists) vs update (PUT content, 404 if missing).
  createSkillRaw(name: string, content: string): Promise<unknown>
  updateSkillContent(name: string, content: string): Promise<unknown>
  getSkillContent(name: string): Promise<SkillContent>
  setSkillEnabled(name: string, enabled: boolean): Promise<unknown>
}

// Skills endpoints. `createSkill` wraps the plain-language description into the
// Hermes Skill content contract before POSTing; `createSkillRaw` posts exact content.
export function createSkillsApi(api: ApiFn): HermesSkillsApi {
  return {
    listSkills() {
      return api<Skill[]>(withProfile('/api/skills'))
    },

    createSkill(name, description) {
      const content = buildSkillContent(name, description)
      return api('/api/skills', {
        method: 'POST',
        body: { name, content, category: 'business', profile: 'default' }
      })
    },

    createSkillRaw(name, content) {
      return api('/api/skills', {
        method: 'POST',
        body: { name, content, category: 'business', profile: 'default' }
      })
    },

    // Full-rewrite update of an existing skill's SKILL.md (PUT /api/skills/content).
    updateSkillContent(name, content) {
      return api('/api/skills/content', {
        method: 'PUT',
        body: { name, content, profile: 'default' }
      })
    },

    getSkillContent(name) {
      return api<SkillContent>(withProfile(`/api/skills/content?name=${encodeURIComponent(name)}`))
    },

    // Enable/disable via the config-backed disabled-skills list (PUT /api/skills/toggle).
    setSkillEnabled(name, enabled) {
      return api('/api/skills/toggle', {
        method: 'PUT',
        body: { name, enabled, profile: 'default' }
      })
    }
  }
}
