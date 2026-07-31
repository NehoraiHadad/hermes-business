import type { HermesMessagingPlatform } from '../connections'
import { restartAndVerify, withProfile, type ApiFn } from './core'
import type { MessagingTest } from './whatsapp-rest'

export interface HermesMessagingApi {
  listMessagingPlatforms(): Promise<HermesMessagingPlatform[]>
  testMessagingPlatform(id: string): Promise<MessagingTest>
  connectTelegram(token: string, userId: string): Promise<MessagingTest>
}

// Messaging-connector endpoints: list/test platforms and the guided Telegram
// connect flow (save -> restart gateway -> confirm live via restartAndVerify).
export function createMessagingApi(
  api: ApiFn,
  ensureGateway: () => Promise<unknown>
): HermesMessagingApi {
  const testMessagingPlatform: HermesMessagingApi['testMessagingPlatform'] = id =>
    api(withProfile(`/api/messaging/platforms/${encodeURIComponent(id)}/test`), { method: 'POST' })

  return {
    testMessagingPlatform,

    async listMessagingPlatforms() {
      const result = await api<{ platforms?: HermesMessagingPlatform[] }>(
        withProfile('/api/messaging/platforms')
      )
      return Array.isArray(result.platforms) ? result.platforms : []
    },

    async connectTelegram(token, userId) {
      await api(withProfile('/api/messaging/platforms/telegram'), {
        method: 'PUT',
        body: {
          enabled: true,
          env: { TELEGRAM_BOT_TOKEN: token, TELEGRAM_ALLOWED_USERS: userId },
          clear_env: []
        }
      })
      return restartAndVerify({
        restart: async () => {
          await ensureGateway()
          await api(withProfile('/api/gateway/restart'), { method: 'POST' })
        },
        verify: () => testMessagingPlatform('telegram'),
        timeoutMessage:
          'Hermes שמר את הפרטים, אבל Telegram עדיין לא דיווח על חיבור פעיל. בדוק את ה־token ונסה שוב.'
      })
    }
  }
}
