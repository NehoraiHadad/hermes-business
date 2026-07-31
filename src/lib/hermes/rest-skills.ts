import type { Skill } from '../../types'
import { buildSkillContent } from '../skill-content'
import { withProfile, type ApiFn } from './core'

export interface HermesSkillsApi {
  listSkills(): Promise<Skill[]>
  createSkill(name: string, description: string): Promise<unknown>
}

// Skills endpoints. `createSkill` wraps the plain-language description into the
// Hermes Skill content contract before POSTing.
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
    }
  }
}
