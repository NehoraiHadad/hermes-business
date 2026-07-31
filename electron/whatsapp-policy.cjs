const fs = require('node:fs')
const path = require('node:path')
const { hermesHome } = require('./paths.cjs')
const { writeWhatsappPrivateFile } = require('./whatsapp-privacy.cjs')

const MODES = new Set(['read_only', 'selected_chats'])

function policyPath() {
  return path.join(hermesHome(), 'business', 'whatsapp-policy.json')
}

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
  const replyChats = [...new Set(rawChats.map(normalizeChat).filter(Boolean))]
  if (mode === 'selected_chats' && replyChats.length === 0) {
    throw new Error('יש לבחור לפחות צ׳אט אחד שבו מותר לעוזר לענות.')
  }
  return { version: 1, mode, reply_chats: replyChats }
}

function getWhatsappPolicy() {
  try {
    return normalizePolicy(JSON.parse(fs.readFileSync(policyPath(), 'utf8')))
  } catch {
    return { version: 1, mode: 'read_only', reply_chats: [] }
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

module.exports = { getWhatsappPolicy, normalizePolicy, setWhatsappPolicy }
