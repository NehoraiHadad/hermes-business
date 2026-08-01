const { normalizeTelegram } = require('./telegram-policy.cjs')

// Legacy migration for existing Telegram setups. A Telegram bot configured
// before this policy existed carries only Hermes ingress env (allowlist / allow-
// all) and no telegram-policy.json. We derive an EXPLICIT policy that preserves
// the operator's evident intent, and default genuinely ambiguous state to the
// safe read_only mode — never to answering everyone.
//
//   * TELEGRAM_ALLOW_ALL_USERS truthy      -> full_access (they opted everyone in)
//   * TELEGRAM_ALLOWED_USERS / GROUP chats -> selected_chats with those ids
//   * configured token but neither of above -> read_only (ambiguous -> safe)
//   * not configured                        -> null (nothing to migrate)

function truthy(value) {
  return ['true', '1', 'yes'].includes(String(value || '').trim().toLowerCase())
}

function splitIds(value) {
  return String(value || '')
    .split(/[,\n]/)
    .map(normalizeTelegram)
    .filter(Boolean)
}

// Pure derivation. `env` is a plain map of the Telegram-relevant Hermes env vars.
function deriveLegacyTelegramPolicy(env = {}) {
  const configured = Boolean(String(env.TELEGRAM_BOT_TOKEN || '').trim())
  if (!configured) return null
  if (truthy(env.TELEGRAM_ALLOW_ALL_USERS)) {
    return { version: 1, mode: 'full_access', reply_chats: [] }
  }
  const ids = [
    ...splitIds(env.TELEGRAM_ALLOWED_USERS),
    ...splitIds(env.TELEGRAM_GROUP_ALLOWED_CHATS)
  ].filter(id => id !== '*')
  const reply_chats = [...new Set(ids)]
  if (reply_chats.length) return { version: 1, mode: 'selected_chats', reply_chats }
  return { version: 1, mode: 'read_only', reply_chats: [] }
}

// Migrate only when no explicit policy exists yet. Preserves an existing policy
// file verbatim (idempotent) and never overwrites an operator's saved choice.
function migrateTelegramPolicy({ hasPolicy, readEnv, writePolicy }) {
  if (hasPolicy()) return { migrated: false, reason: 'policy-exists' }
  const derived = deriveLegacyTelegramPolicy(readEnv())
  if (!derived) return { migrated: false, reason: 'not-configured' }
  writePolicy(derived)
  return { migrated: true, mode: derived.mode }
}

module.exports = { deriveLegacyTelegramPolicy, migrateTelegramPolicy }
