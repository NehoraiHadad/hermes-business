const fs = require('node:fs')
const path = require('node:path')
const { hermesHome } = require('./paths.cjs')
const { writeWhatsappPrivateFile } = require('./whatsapp-privacy.cjs')

// Telegram reply policy file I/O. The Hermes plugin
// (business-whatsapp-policy/telegram_policy.py) is the authoritative enforcer;
// this only records the operator's choice. Unlike WhatsApp there are three
// modes; the fail-closed default is read_only.
const MODES = new Set(['full_access', 'read_only', 'selected_chats'])

function policyPath() {
  return path.join(hermesHome(), 'business', 'telegram-policy.json')
}

// Keep in lockstep with normalize_identifier() in telegram_policy.py and
// normalizeTelegram() in src/lib/telegram-policy.ts.
function normalizeTelegram(value) {
  let raw = String(value || '')
    .trim()
    .replace(/^telegram:/i, '')
    .replace(/^@/, '')
  if (!raw) return ''
  if (/^-?\d+$/.test(raw)) {
    const negative = raw.startsWith('-')
    const digits = raw.replace(/^-/, '').replace(/^0+(?=\d)/, '')
    return negative && digits !== '0' ? `-${digits}` : digits
  }
  return raw.toLowerCase()
}

function normalizePolicy(candidate = {}) {
  const mode = MODES.has(candidate.mode) ? candidate.mode : 'read_only'
  const rawChats = Array.isArray(candidate.reply_chats)
    ? candidate.reply_chats
    : String(candidate.reply_chats || '').split(/[,\n]/)
  const replyChats = [...new Set(rawChats.map(normalizeTelegram).filter(Boolean))]
  if (mode === 'selected_chats' && replyChats.length === 0) {
    throw new Error('יש לבחור לפחות משתמש או קבוצה אחת שבהם מותר לעוזר לענות.')
  }
  return { version: 1, mode, reply_chats: replyChats }
}

function getTelegramPolicy() {
  try {
    return normalizePolicy(JSON.parse(fs.readFileSync(policyPath(), 'utf8')))
  } catch {
    return { version: 1, mode: 'read_only', reply_chats: [] }
  }
}

function setTelegramPolicy(candidate) {
  const policy = normalizePolicy(candidate)
  // Holds PII (allow-listed ids). Confidentiality comes from the per-user Hermes
  // home ACL on Windows and 0o600 on POSIX — see whatsapp-privacy.cjs.
  writeWhatsappPrivateFile(policyPath(), `${JSON.stringify(policy, null, 2)}\n`)
  return policy
}

module.exports = { getTelegramPolicy, normalizePolicy, normalizeTelegram, setTelegramPolicy }
