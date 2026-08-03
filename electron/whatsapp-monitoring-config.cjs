const { getConfig, putConfig } = require('./hermes-config.cjs')
const { readWhatsappDirectory } = require('./whatsapp-directory.cjs')
const { normalizeChat: principal } = require('./whatsapp-policy.cjs')

const START = '[HERMES_BUSINESS_MONITORING]'
const END = '[/HERMES_BUSINESS_MONITORING]'

function stripOwned(prompt) {
  const text = String(prompt || '')
  const start = text.indexOf(START)
  const end = text.indexOf(END, start + START.length)
  if (start < 0 || end < 0) return text.trim()
  return `${text.slice(0, start)}${text.slice(end + END.length)}`.trim()
}

function monitoringPrompt(policy, name) {
  const ownerRule = policy.behavior === 'assist'
    ? 'You may reply when useful and perform only actions already allowed by Hermes. All existing approval rules remain mandatory.'
    : 'Never send a visible reply in this source. When the owner needs attention, create an appropriate Hermes reminder/task for the configured home channel.'
  return [
    START,
    `You are monitoring the WhatsApp source named "${String(name || 'selected source').slice(0, 120)}" for its business owner.`,
    ownerRule,
    'Notice meeting requests, agreed dates, unanswered customer needs, decisions and reusable business knowledge.',
    'Check calendar context before proposing availability. Never promise, book, send, delete or change external state without the permissions and approvals already configured in Hermes.',
    'Use Hermes Memory, Skills and scheduling mechanisms instead of inventing parallel state.',
    policy.instructions ? `Owner instructions: ${policy.instructions}` : '',
    policy.behavior === 'monitor' ? 'When no owner-facing task is required, return exactly (silent).' : '',
    END
  ].filter(Boolean).join('\n')
}

function sourceNames(directory = readWhatsappDirectory()) {
  return new Map(directory.map(source => [`${source.platform}:${source.id}`, source.name]))
}

function overridesFor(platform, policy, previous, config, names) {
  const forPlatform = value => value.mode === 'selected_chats'
    ? (value.sources || []).filter(source => source.platform === platform)
    : []
  const current = forPlatform(policy)
  const prior = forPlatform(previous)
  const currentIds = current.map(source => source.id)
  const previousIds = prior.map(source => source.id)
  const existing = config?.platforms?.[platform]?.channel_overrides || {}
  const patch = {}
  for (const id of new Set([...currentIds, ...previousIds])) {
    const base = stripOwned(existing[id]?.system_prompt)
    const source = current.find(item => item.id === id)
    const owned = source ? monitoringPrompt(policy, source.name || names.get(`${platform}:${id}`)) : ''
    patch[id] = { system_prompt: [base, owned].filter(Boolean).join('\n\n') || null }
  }
  return patch
}

async function applyMonitoringConfig(policy, previous, api) {
  const config = await getConfig(api)
  const names = sourceNames()
  const selected = policy.mode === 'selected_chats'
  const qr = selected ? policy.sources.filter(source => source.platform === 'whatsapp') : []
  const cloudSources = selected ? policy.sources.filter(source => source.platform === 'whatsapp_cloud') : []
  const qrDms = qr.filter(source => source.type === 'dm').map(source => principal(source.id))
  const groups = qr.filter(source => source.type === 'group').map(source => source.id)
  const cloudDms = cloudSources.filter(source => source.type === 'dm').map(source => principal(source.id))
  const whatsapp = {
    dm_policy: selected ? (qrDms.length ? 'allowlist' : 'disabled') : 'pairing',
    allow_from: qrDms,
    group_policy: selected ? (groups.length ? 'allowlist' : 'disabled') : 'open',
    group_allow_from: groups,
    require_mention: false,
    channel_overrides: overridesFor('whatsapp', policy, previous, config, names)
  }
  const cloud = {
    dm_policy: selected ? (cloudDms.length ? 'allowlist' : 'disabled') : 'pairing',
    allow_from: cloudDms,
    group_policy: 'disabled',
    channel_overrides: overridesFor('whatsapp_cloud', policy, previous, config, names)
  }
  await putConfig({ platforms: { whatsapp, whatsapp_cloud: cloud } }, api)
}

module.exports = { START, END, stripOwned, monitoringPrompt, overridesFor, applyMonitoringConfig }
