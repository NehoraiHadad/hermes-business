import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSkillContent } from './skill-content'
import { HermesTransport, type ConnectionState } from './hermes/transport'
import { FakeWebSocket, ManualClock } from './hermes/fake-websocket'

describe('Hermes Skill document creation', () => {
  it('keeps the routing description inside Hermes 60-character budget', () => {
    const content = buildSkillContent(
      'a-very-long-business-process-name-that-needs-truncation',
      'This detailed procedure belongs in the body and may be much longer.'
    )
    const routingLine = content.split('\n').find(line => line.startsWith('description: '))
    const routingDescription = JSON.parse(routingLine?.slice('description: '.length) || '""')
    expect(routingDescription.length).toBeLessThanOrEqual(60)
    expect(routingDescription.endsWith('.')).toBe(true)
    expect(content).toContain('This detailed procedure belongs in the body')
  })
})

// The client facade is imported dynamically: the module builds its singleton at
// import time, which needs `window` to exist first (the app's real environment).
const WS_URL = 'ws://hermes/dashboard'
const REAL_MODE = { hasBridge: true, explicitDemo: false, isDev: false, demoAllowed: false }
const DEMO_MODE = { hasBridge: false, explicitDemo: true, isDev: true, demoAllowed: true }
const NO_BRIDGE_MODE = { hasBridge: false, explicitDemo: false, isDev: false, demoAllowed: false }

async function loadClient() {
  vi.stubGlobal('window', { hermesDesktop: {}, location: { search: '' } })
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.resetModules()
  return (await import('./hermes-client')).HermesClient
}

beforeEach(() => {
  FakeWebSocket.instances = []
})

afterEach(() => vi.unstubAllGlobals())

describe('HermesClient connection surface', () => {
  it('recovers transparently: rpc works again after the gateway drops and returns', async () => {
    const HermesClient = await loadClient()
    const clock = new ManualClock()
    const transport = new HermesTransport({ timers: clock.timers, random: () => 0 })
    const client = new HermesClient({ transport, mode: REAL_MODE })
    const states: ConnectionState[] = []
    client.onConnectionChange(state => states.push(state))

    const opened = client.connect(WS_URL)
    FakeWebSocket.instances.at(-1)!.open()
    await opened
    expect(client.connected).toBe(true)

    FakeWebSocket.instances.at(-1)!.close()
    expect(client.connected).toBe(false)
    await expect(client.rpc('session.list')).rejects.toThrow('Hermes is not connected')

    await clock.advance(500)
    FakeWebSocket.instances.at(-1)!.open()
    await ManualClock.flush()
    expect(client.connected).toBe(true)
    expect(client.connectionState).toBe('open')
    expect(states).toEqual(['open', 'closed', 'reconnecting', 'open'])

    const socket = FakeWebSocket.instances.at(-1)!
    const call = client.rpc<{ sessions: [] }>('session.list')
    const id = JSON.parse(socket.sent[0]).id as string
    socket.deliver({ jsonrpc: '2.0', id, result: { sessions: [] } })
    await expect(call).resolves.toEqual({ sessions: [] })
  })

  it('waitForConnection proves the socket is usable again after a restart', async () => {
    const HermesClient = await loadClient()
    const clock = new ManualClock()
    const transport = new HermesTransport({ timers: clock.timers, random: () => 0 })
    const client = new HermesClient({ transport, mode: REAL_MODE })

    const waiting = client.waitForConnection({ wsUrl: WS_URL, timeoutMs: 30_000, pollMs: 500 })
    await ManualClock.flush()
    FakeWebSocket.instances.at(-1)!.open()
    await expect(waiting).resolves.toBe(true)
  })

  it('waitForConnection reports failure honestly when the gateway never returns', async () => {
    const HermesClient = await loadClient()
    const clock = new ManualClock()
    const transport = new HermesTransport({ timers: clock.timers, random: () => 0 })
    const client = new HermesClient({ transport, mode: REAL_MODE })

    const waiting = client.waitForConnection({ wsUrl: WS_URL, timeoutMs: 2_000, pollMs: 500 })
    await clock.advance(2_500)
    await expect(waiting).resolves.toBe(false)
  })

  it('demo needs no socket: always connected, never opens or retries one', async () => {
    const HermesClient = await loadClient()
    const clock = new ManualClock()
    const transport = new HermesTransport({ timers: clock.timers })
    const client = new HermesClient({ transport, mode: DEMO_MODE })
    expect(client.demo).toBe(true)
    expect(client.connected).toBe(true)
    expect(client.connectionState).toBe('open')
    await expect(client.waitForConnection({ timeoutMs: 1_000 })).resolves.toBe(true)
    await clock.advance(60_000)
    expect(FakeWebSocket.instances).toHaveLength(0)
  })

  it('a missing bridge cannot reconnect in-process and says so', async () => {
    const HermesClient = await loadClient()
    const transport = new HermesTransport()
    const client = new HermesClient({ transport, mode: NO_BRIDGE_MODE })
    expect(client.bridgeMissing).toBe(true)
    await expect(client.waitForConnection({ timeoutMs: 1_000 })).resolves.toBe(false)
    expect(FakeWebSocket.instances).toHaveLength(0)
  })
})
