import { describe, expect, it } from 'vitest'
import type { Connection } from '../types'
import { connectionStateFromPlatform, hydrateConnectionStates } from './connections'

const base: Connection[] = [
  {
    id: 'google',
    name: 'Google Workspace',
    description: '',
    state: 'available',
    icon: 'google'
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: '',
    state: 'available',
    icon: 'telegram'
  }
]

describe('Hermes connection status mapping', () => {
  it('only calls a messaging platform connected after the gateway reports connected', () => {
    expect(
      connectionStateFromPlatform({
        id: 'telegram',
        enabled: true,
        configured: true,
        gateway_running: true,
        state: 'pending_restart'
      })
    ).toBe('attention')
    expect(
      connectionStateFromPlatform({
        id: 'telegram',
        enabled: true,
        configured: true,
        gateway_running: true,
        state: 'connected'
      })
    ).toBe('connected')
  })

  it('hydrates Google and Telegram from Hermes rather than local UI memory', () => {
    const hydrated = hydrateConnectionStates(
      base,
      [{ id: 'telegram', enabled: true, configured: true, state: 'connected' }],
      true
    )
    expect(hydrated.find(item => item.id === 'google')?.state).toBe('connected')
    expect(hydrated.find(item => item.id === 'telegram')?.state).toBe('connected')
  })
})
