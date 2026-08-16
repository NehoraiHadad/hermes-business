import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import { COMMUNITY_ARCHIVE_PLUGIN_FILES, generateArtifacts } from './generate.mjs'

const contract = {
  name: 'קהילה',
  wakeWord: 'תכלס',
  admins: ['972501234567'],
  groups: [
    { slug: 'general', jid: '120363000000000001@g.us', name: 'כללי', purpose: 'מידע', tone: 'default', isolated: false, knowledge: [] },
    { slug: 'private', jid: '120363000000000002@g.us', name: 'פרטי', purpose: 'רגיש', tone: 'strict', isolated: true, knowledge: [] }
  ],
  knowledge: {}
}

const template = name => `---\nname: ${name}\ndescription: "קהילה"\n---\n{{HOME_DIR}} {{CONTRACT_PATH}} {{INSTALL_ROOT}} {{GENERATE_CLI}} {{PROVISION_CLI}}\n`

describe('community model propagation after OAuth', () => {
  it('writes the root provider/default into every shared and isolated routed profile', () => {
    const model = { provider: 'openai-codex', default: 'openai-codex/gpt-5' }
    const artifacts = generateArtifacts(contract, {
      existingConfigText: yaml.dump({ model }),
      readKnowledgeSource: () => '',
      readAdminSkillTemplate: template,
      readCommunityPluginFile: name => COMMUNITY_ARCHIVE_PLUGIN_FILES.includes(name) ? '# plugin\n' : undefined,
      deployPaths: {
        HOME_DIR: 'C:\\Community\\home',
        CONTRACT_PATH: 'C:\\Community\\community.yaml',
        INSTALL_ROOT: 'C:\\Community',
        GENERATE_CLI: 'C:\\Tools\\community-generate.mjs',
        PROVISION_CLI: 'C:\\Tools\\community-provision.mjs'
      }
    })

    expect(yaml.load(artifacts['config.yaml']).model).toEqual(model)
    expect(yaml.load(artifacts['profiles/village/config.yaml']).model).toEqual(model)
    expect(yaml.load(artifacts['profiles/private/config.yaml']).model).toEqual(model)
  })
})
