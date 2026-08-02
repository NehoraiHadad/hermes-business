import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { END, START, applyMonitoringConfig, monitoringPrompt, overridesFor, stripOwned } =
  require('../../electron/whatsapp-monitoring-config.cjs')

const selected = {
  version: 2, mode: 'selected_chats', behavior: 'monitor', instructions: 'זהה בקשות לפגישה',
  reply_chats: ['111'], reply_groups: ['222@g.us'],
  sources: [
    { id: '111@s.whatsapp.net', name: 'דני', type: 'dm', platform: 'whatsapp' },
    { id: '222@g.us', name: 'לקוחות', type: 'group', platform: 'whatsapp' }
  ]
}
const readOnly = { ...selected, mode: 'read_only', reply_chats: [], reply_groups: [], sources: [] }

describe('WhatsApp monitoring config over Hermes channel overrides', () => {
  it('keeps a pre-existing Hermes prompt outside the owned block', () => {
    const prompt = `existing\n\n${monitoringPrompt(selected, 'VIP')}\n\nafter`
    expect(prompt).toContain(START)
    expect(prompt).toContain(END)
    expect(stripOwned(prompt)).toContain('existing')
    expect(stripOwned(prompt)).toContain('after')
    expect(stripOwned(prompt)).not.toContain(START)
  })

  it('adds prompts to selected DMs/groups and removes only its own block', () => {
    const config = { platforms: { whatsapp: { channel_overrides: {
      '111@s.whatsapp.net': { system_prompt: 'user prompt' },
      old: { system_prompt: `keep\n${START}\nstale\n${END}` }
    }}}}
    const names = new Map([['whatsapp:111@s.whatsapp.net', 'דני'], ['whatsapp:222@g.us', 'לקוחות']])
    const prior = { ...readOnly, mode: 'selected_chats', sources: [{ id: 'old', name: 'old', type: 'dm', platform: 'whatsapp' }] }
    const added = overridesFor('whatsapp', selected, prior, config, names)
    expect(added['111@s.whatsapp.net'].system_prompt).toContain('user prompt')
    expect(added['111@s.whatsapp.net'].system_prompt).toContain('דני')
    expect(added['222@g.us'].system_prompt).toContain('לקוחות')
    expect(added.old.system_prompt).toBe('keep')
  })

  it('keeps QR groups and Cloud DMs in separate native Hermes policies', async () => {
    const policy = { ...selected, sources: [
      ...selected.sources,
      { id: '333', name: 'Cloud', type: 'dm', platform: 'whatsapp_cloud' }
    ] }
    const api = vi.fn().mockResolvedValueOnce({ config: {} }).mockResolvedValueOnce({ ok: true })
    await applyMonitoringConfig(policy, readOnly, api)
    const patch = api.mock.calls[1][1].body.config.platforms
    expect(patch.whatsapp.allow_from).toEqual(['111'])
    expect(patch.whatsapp.group_allow_from).toEqual(['222@g.us'])
    expect(patch.whatsapp_cloud.allow_from).toEqual(['333'])
    expect(patch.whatsapp_cloud.group_policy).toBe('disabled')
    expect(patch.whatsapp_cloud.channel_overrides['222@g.us']).toBeUndefined()
  })
})
