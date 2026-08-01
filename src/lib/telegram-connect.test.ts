import { describe, expect, it, vi } from 'vitest'
import { connectTelegramWithPolicy } from './telegram-connect'
import type { TelegramPolicy } from './telegram-policy'

const readOnly = { version: 1 as const, mode: 'read_only' as const, reply_chats: [] }

describe('Telegram connection policy', () => {
  it('seeds owner-only replies before enabling a fresh connection', async () => {
    const events: string[] = []
    const bridge = {
      getTelegramPolicy: vi.fn(async () => readOnly),
      ensureTelegramPolicy: vi.fn(async () => events.push('ensure')),
      setTelegramPolicy: vi.fn(async (policy: TelegramPolicy) =>
        events.push(`policy:${policy.mode}:${policy.reply_chats[0]}`)
      )
    }

    await connectTelegramWithPolicy({
      token: 'token',
      userId: '123',
      explicitPolicy: undefined,
      demo: false,
      bridge,
      connect: vi.fn(async () => events.push('connect'))
    })

    expect(events).toEqual(['ensure', 'policy:selected_chats:123', 'connect'])
  })

  it('preserves an explicit read-only choice', async () => {
    const setTelegramPolicy = vi.fn(async () => undefined)
    await connectTelegramWithPolicy({
      token: 'token',
      userId: '123',
      explicitPolicy: readOnly,
      demo: false,
      bridge: {
        getTelegramPolicy: vi.fn(async () => readOnly),
        ensureTelegramPolicy: vi.fn(async () => undefined),
        setTelegramPolicy
      },
      connect: vi.fn(async () => undefined)
    })
    expect(setTelegramPolicy).toHaveBeenCalledWith(readOnly)
  })
})
