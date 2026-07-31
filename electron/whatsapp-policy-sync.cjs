const { normalizePolicy, setWhatsappPolicy } = require('./whatsapp-policy.cjs')

const PLATFORM_ENDPOINT = '/api/messaging/platforms/whatsapp?profile=default'
const ENV_ENDPOINT = '/api/env?profile=default'
const RESTART_ENDPOINT = '/api/gateway/restart?profile=default'

function nativeUpdateForPolicy(policy) {
  const env = { WHATSAPP_DM_POLICY: 'pairing' }
  const clear_env = []
  if (policy.mode === 'selected_chats') {
    env.WHATSAPP_ALLOWED_USERS = policy.reply_chats.join(',')
  } else {
    clear_env.push('WHATSAPP_ALLOWED_USERS')
  }
  return { env, clear_env }
}

function cloudEnvForPolicy(policy) {
  return {
    WHATSAPP_CLOUD_DM_POLICY: 'pairing',
    WHATSAPP_CLOUD_ALLOWED_USERS:
      policy.mode === 'selected_chats' ? policy.reply_chats.join(',') : ''
  }
}

async function saveWhatsappPolicySynced(candidate, options = {}) {
  const policy = normalizePolicy(candidate)
  const api = options.api || require('./runtime.cjs').hermesApi
  const writePolicy = options.writePolicy || setWhatsappPolicy

  const catalog = await api('/api/messaging/platforms?profile=default')
  const whatsapp = (catalog.platforms || []).find(item => item.id === 'whatsapp')
  await api(PLATFORM_ENDPOINT, {
    method: 'PUT',
    body: nativeUpdateForPolicy(policy)
  })
  for (const [key, value] of Object.entries(cloudEnvForPolicy(policy))) {
    await api(ENV_ENDPOINT, {
      method: 'PUT',
      body: { key, value, profile: 'default' }
    })
  }

  // The plugin remains the stricter gate during this two-store update:
  // whichever write lands first, the effective permission is the intersection.
  const saved = writePolicy(policy)
  let gatewayRestarted = false
  const cloud = (catalog.platforms || []).find(item => item.id === 'whatsapp_cloud')
  if (whatsapp?.enabled || cloud?.enabled) {
    await api(RESTART_ENDPOINT, { method: 'POST' })
    gatewayRestarted = true
  }
  return { ...saved, nativeSynced: true, gatewayRestarted }
}

module.exports = { cloudEnvForPolicy, nativeUpdateForPolicy, saveWhatsappPolicySynced }
