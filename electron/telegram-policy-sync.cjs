const { normalizePolicy, setTelegramPolicy } = require('./telegram-policy.cjs')

// Telegram policy sync. The plugin is the authoritative read-only/selected
// EGRESS enforcer. The official Hermes env allowlists gate INGRESS (who may
// reach the bot); in selected mode we narrow them to the chosen set as
// defense-in-depth, so the effective permission is the intersection. Group /
// channel ids (negative) go to TELEGRAM_GROUP_ALLOWED_CHATS; users / usernames
// go to TELEGRAM_ALLOWED_USERS. See telegram-policy-sync notes for the
// full_access ingress caveat (ingress stays governed by the connect allowlist).
const PLATFORM_ENDPOINT = '/api/messaging/platforms/telegram?profile=default'
const RESTART_ENDPOINT = '/api/gateway/restart?profile=default'

function telegramEnvForPolicy(policy) {
  const env = {}
  const clear_env = []
  if (policy.mode === 'selected_chats') {
    const users = []
    const chats = []
    for (const id of policy.reply_chats) (/^-\d+$/.test(id) ? chats : users).push(id)
    env.TELEGRAM_ALLOWED_USERS = users.join(',')
    if (chats.length) env.TELEGRAM_GROUP_ALLOWED_CHATS = chats.join(',')
    else clear_env.push('TELEGRAM_GROUP_ALLOWED_CHATS')
  } else {
    // read_only / full_access: never leave a stale group-chat narrowing. The
    // plugin enforces egress; ingress user allowlist stays as the connect flow
    // configured it (we do not know the owner's id to safely rewrite it).
    clear_env.push('TELEGRAM_GROUP_ALLOWED_CHATS')
  }
  return { env, clear_env }
}

async function saveTelegramPolicySynced(candidate, options = {}) {
  const policy = normalizePolicy(candidate)
  const api = options.api || require('./runtime.cjs').hermesApi
  const writePolicy = options.writePolicy || setTelegramPolicy

  const catalog = await api('/api/messaging/platforms?profile=default')
  const telegram = (catalog.platforms || []).find(item => item.id === 'telegram')
  await api(PLATFORM_ENDPOINT, { method: 'PUT', body: telegramEnvForPolicy(policy) })

  // The plugin remains the stricter gate during this two-store update:
  // whichever write lands first, the effective permission is the intersection.
  const saved = writePolicy(policy)
  let gatewayRestarted = false
  if (telegram?.enabled) {
    await api(RESTART_ENDPOINT, { method: 'POST' })
    gatewayRestarted = true
  }
  return { ...saved, nativeSynced: true, gatewayRestarted }
}

module.exports = { telegramEnvForPolicy, saveTelegramPolicySynced }
