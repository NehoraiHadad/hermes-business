const { getWhatsappPolicy, normalizePolicy, setWhatsappPolicy, normalizeChat } = require('./whatsapp-policy.cjs')
const { applyMonitoringConfig } = require('./whatsapp-monitoring-config.cjs')

const PLATFORM_ENDPOINT = '/api/messaging/platforms/whatsapp?profile=default'
const ENV_ENDPOINT = '/api/env?profile=default'
const RESTART_ENDPOINT = '/api/gateway/restart?profile=default'
const HEALTH_ENDPOINT = '/api/health'

function dmPrincipals(policy, platform) {
  return (policy.sources || [])
    .filter(source => source.platform === platform && source.type === 'dm')
    .map(source => normalizeChat(source.id))
}

function nativeUpdateForPolicy(policy) {
  const chats = dmPrincipals(policy, 'whatsapp')
  const env = {
    WHATSAPP_DM_POLICY: policy.mode === 'selected_chats' && chats.length
      ? 'allowlist'
      : 'pairing'
  }
  const clear_env = []
  if (policy.mode === 'selected_chats' && chats.length) {
    env.WHATSAPP_ALLOWED_USERS = chats.join(',')
  } else {
    clear_env.push('WHATSAPP_ALLOWED_USERS')
  }
  return { env, clear_env }
}

function cloudEnvForPolicy(policy) {
  const chats = dmPrincipals(policy, 'whatsapp_cloud')
  return {
    WHATSAPP_CLOUD_DM_POLICY:
      policy.mode === 'selected_chats' && chats.length ? 'allowlist' : 'pairing',
    WHATSAPP_CLOUD_ALLOWED_USERS:
      policy.mode === 'selected_chats' ? chats.join(',') : ''
  }
}

async function saveWhatsappPolicySynced(candidate, options = {}) {
  const policy = normalizePolicy(candidate)
  const api = options.api || require('./runtime.cjs').hermesApi
  const writePolicy = options.writePolicy || setWhatsappPolicy
  const previous = options.previousPolicy || getWhatsappPolicy()

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

  await (options.applyMonitoring || applyMonitoringConfig)(policy, previous, api)

  // The plugin remains the stricter gate during this two-store update:
  // whichever write lands first, the effective permission is the intersection.
  const saved = writePolicy(policy)
  let gatewayRestarted = false
  const cloud = (catalog.platforms || []).find(item => item.id === 'whatsapp_cloud')
  if (whatsapp?.enabled || cloud?.enabled) {
    await api(RESTART_ENDPOINT, { method: 'POST' })
    const health = await api(HEALTH_ENDPOINT)
    if (!health?.ok) throw new Error('Hermes failed its post-policy health check')
    gatewayRestarted = true
  }
  return { ...saved, nativeSynced: true, gatewayRestarted, healthChecked: gatewayRestarted }
}

module.exports = { cloudEnvForPolicy, nativeUpdateForPolicy, saveWhatsappPolicySynced }
