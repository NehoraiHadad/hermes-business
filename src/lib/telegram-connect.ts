import {
  DEFAULT_TELEGRAM_POLICY,
  resolveTelegramConnectPolicy,
  type TelegramPolicy
} from './telegram-policy'

type PolicyBridge = {
  getTelegramPolicy: () => Promise<TelegramPolicy>
  ensureTelegramPolicy: () => Promise<unknown>
  setTelegramPolicy: (policy: TelegramPolicy) => Promise<unknown>
}

export async function connectTelegramWithPolicy(input: {
  token: string
  userId: string
  explicitPolicy: TelegramPolicy | null | undefined
  demo: boolean
  bridge?: PolicyBridge
  connect: (token: string, userId: string) => Promise<unknown>
}): Promise<void> {
  if (input.explicitPolicy === null) {
    throw new Error('יש להשלים את רשימת המשתמשים או הקבוצות שמותר לעוזר לענות להם.')
  }
  const saved = input.demo || !input.bridge
    ? DEFAULT_TELEGRAM_POLICY
    : await input.bridge.getTelegramPolicy()
  const resolved = resolveTelegramConnectPolicy(saved, input.userId, input.explicitPolicy)
  if ('error' in resolved) throw new Error(resolved.error)

  if (!input.demo) {
    if (!input.bridge) throw new Error('רכיב החיבור של Telegram אינו זמין.')
    await input.bridge.ensureTelegramPolicy()
    await input.bridge.setTelegramPolicy(resolved.policy)
  }
  await input.connect(input.token, input.userId)
}
