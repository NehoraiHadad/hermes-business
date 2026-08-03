const fs = require('node:fs')
const path = require('node:path')
const { hermesHome } = require('./paths.cjs')
const { writeWhatsappPrivateFile } = require('./whatsapp-privacy.cjs')

const MODES = new Set(['read_only', 'selected_chats'])
const PLATFORMS = new Set(['whatsapp', 'whatsapp_cloud'])

function policyPath() {
  return path.join(hermesHome(), 'business', 'whatsapp-policy.json')
}

// The ONE WhatsApp/WhatsApp-Cloud principal (DM chat id) normalizer. Strips the
// platform prefix, a leading '+', and the JID suffix, lower-cases, and — when
// what remains looks like a phone number — collapses it to digits only. This
// feeds the plugin allow-list (this file), the native platform env
// (whatsapp-policy-sync.cjs), and channel overrides (whatsapp-monitoring-config.cjs);
// those three MUST agree on a representative principal, or the effective
// permission boundary silently diverges across stores. See
// whatsapp-policy.test.ts for the cross-consumer agreement test.
function normalizeChat(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^whatsapp(?:_cloud)?:/, '')
    .replace(/^\+/, '')
    .replace(/@(?:s\.whatsapp\.net|lid)$/i, '')
  return /^[\d\s().-]+$/.test(normalized)
    ? normalized.replace(/\D/g, '')
    : normalized
}

function normalizePolicy(candidate = {}) {
  const mode = MODES.has(candidate.mode) ? candidate.mode : 'read_only'
  const rawChats = Array.isArray(candidate.reply_chats)
    ? candidate.reply_chats
    : String(candidate.reply_chats || '').split(/[,\n]/)
  const rawGroups = Array.isArray(candidate.reply_groups) ? candidate.reply_groups : []
  const legacy = [
    ...rawChats.map(id => ({ id, name: 'בחירה שמורה', type: 'dm', platform: 'whatsapp' })),
    ...rawChats.map(id => ({ id, name: 'בחירה שמורה', type: 'dm', platform: 'whatsapp_cloud' })),
    ...rawGroups.map(id => ({ id, name: 'בחירה שמורה', type: 'group', platform: 'whatsapp' }))
  ]
  const rawSources = Array.isArray(candidate.sources) ? candidate.sources : legacy
  const sources = []
  const seen = new Set()
  for (const item of rawSources) {
    const platform = PLATFORMS.has(item?.platform) ? item.platform : 'whatsapp'
    const type = item?.type === 'group' ? 'group' : 'dm'
    const id = String(item?.id || '').trim()
    if (!id || (platform === 'whatsapp_cloud' && type === 'group')) continue
    const key = `${platform}:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    sources.push({ id, name: String(item?.name || 'בחירה שמורה').trim().slice(0, 160), type, platform })
  }
  const replyChats = [...new Set(sources.filter(item => item.type === 'dm').map(item => normalizeChat(item.id)).filter(Boolean))]
  const replyGroups = [...new Set(sources.filter(item => item.type === 'group').map(item => item.id))]
  if (mode === 'selected_chats' && sources.length === 0) {
    throw new Error('יש לבחור לפחות שיחה או קבוצה אחת.')
  }
  return {
    version: 2,
    mode,
    behavior: candidate.behavior === 'assist' ? 'assist' : 'monitor',
    instructions: String(candidate.instructions || '').trim().slice(0, 2000),
    reply_chats: replyChats,
    reply_groups: replyGroups,
    sources
  }
}

function getWhatsappPolicy() {
  try {
    return normalizePolicy(JSON.parse(fs.readFileSync(policyPath(), 'utf8')))
  } catch {
    return normalizePolicy()
  }
}

function setWhatsappPolicy(candidate) {
  const policy = normalizePolicy(candidate)
  // The policy file holds PII (allow-listed numbers). Confidentiality comes from
  // the per-user Hermes home ACL on Windows (POSIX mode bits are not a Windows
  // access control) and from 0o600 on POSIX — see whatsapp-privacy.cjs.
  writeWhatsappPrivateFile(policyPath(), `${JSON.stringify(policy, null, 2)}\n`)
  return policy
}

module.exports = { getWhatsappPolicy, normalizePolicy, setWhatsappPolicy, normalizeChat }
