import type { ApiFn } from './rest'

export type WhatsappOnboarding = {
  pairing_id: string
  status: 'starting' | 'installing' | 'waiting' | 'connected' | 'error' | 'expired' | 'cancelled'
  qr_payload?: string | null
  expires_at: string
  mode: 'bot' | 'self-chat'
  account_name?: string | null
  account_phone?: string | null
  error?: string | null
}

export type WhatsappCloudCredentials = {
  phoneNumberId: string
  accessToken: string
  appSecret: string
  verifyToken: string
}

export type MessagingTest = { ok?: boolean; state?: string; message?: string }

export interface HermesWhatsappApi {
  startWhatsappOnboarding(mode: 'bot' | 'self-chat', allowedUsers: string): Promise<WhatsappOnboarding>
  pollWhatsappOnboarding(pairingId: string): Promise<WhatsappOnboarding>
  applyWhatsappOnboarding(
    pairingId: string,
    mode: 'bot' | 'self-chat',
    allowedUsers: string
  ): Promise<{ ok?: boolean; platform?: string }>
  cancelWhatsappOnboarding(pairingId: string): Promise<unknown>
  configureWhatsappCloud(credentials: WhatsappCloudCredentials): Promise<MessagingTest>
}

const CLOUD_ENV = {
  appSecret: 'WHATSAPP_CLOUD_APP_SECRET',
  verifyToken: 'WHATSAPP_CLOUD_VERIFY_TOKEN',
  accessToken: 'WHATSAPP_CLOUD_ACCESS_TOKEN',
  // Phone Number ID is the final write: Hermes only enables Cloud when it and
  // the token exist, so a failed earlier write cannot leave an unsafe adapter.
  phoneNumberId: 'WHATSAPP_CLOUD_PHONE_NUMBER_ID'
} as const

async function saveCloudCredentials(api: ApiFn, credentials: WhatsappCloudCredentials) {
  for (const [field, key] of Object.entries(CLOUD_ENV)) {
    await api('/api/env?profile=default', {
      method: 'PUT',
      body: { key, value: credentials[field as keyof WhatsappCloudCredentials], profile: 'default' }
    })
  }
}

export function createWhatsappApi(
  api: ApiFn,
  ensureGateway: () => Promise<unknown> = async () => {}
): HermesWhatsappApi {
  return {
    startWhatsappOnboarding(mode, allowedUsers) {
      return api<WhatsappOnboarding>('/api/messaging/whatsapp/onboarding/start', {
        method: 'POST',
        body: { mode, allowed_users: allowedUsers, profile: 'default' }
      })
    },
    pollWhatsappOnboarding(pairingId) {
      return api(`/api/messaging/whatsapp/onboarding/${encodeURIComponent(pairingId)}`)
    },
    applyWhatsappOnboarding(pairingId, mode, allowedUsers) {
      return api(`/api/messaging/whatsapp/onboarding/${encodeURIComponent(pairingId)}/apply`, {
        method: 'POST',
        body: { mode, allowed_users: allowedUsers, profile: 'default' }
      })
    },
    cancelWhatsappOnboarding(pairingId) {
      return api(`/api/messaging/whatsapp/onboarding/${encodeURIComponent(pairingId)}`, {
        method: 'DELETE'
      })
    },
    async configureWhatsappCloud(credentials) {
      await saveCloudCredentials(api, credentials)
      await ensureGateway()
      await api('/api/gateway/restart?profile=default', { method: 'POST' })
      let result: MessagingTest = {}
      for (let attempt = 0; attempt < 20; attempt += 1) {
        result = await api('/api/messaging/platforms/whatsapp_cloud/test?profile=default', {
          method: 'POST'
        })
        if (result.ok || ['startup_failed', 'not_configured', 'disabled'].includes(String(result.state))) break
        await new Promise(resolve => window.setTimeout(resolve, 1000))
      }
      return result
    }
  }
}
