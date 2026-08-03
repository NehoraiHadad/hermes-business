import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HermesConnectionClosedError, HermesTransport, type ConnectionState, type TransportOptions } from './transport'
import { HermesRpcError } from './core'
import type { GatewayEvent } from '../../types'
import { FakeWebSocket, ManualClock } from './fake-websocket'

// Drive the transport against a faithful fake socket, asserting only public
// behavior (rpc/onEvent/connected/onConnectionChange) rather than private maps
// or timers. Recovery tests inject a ManualClock so backoff is exact.
const URL = 'ws://hermes/dashboard'
// Distinct from every backoff delay so the handshake timer is easy to filter out.
const CONNECT_TIMEOUT = 60_000

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => vi.unstubAllGlobals())

async function connect() {
  const transport = new HermesTransport()
  const opened = transport.connect(URL)
  const socket = FakeWebSocket.instances.at(-1)!
  socket.open()
  await opened
  return { transport, socket }
}

// A transport on a controllable clock: no real timers, deterministic jitter.
function makeClocked(options: TransportOptions = {}) {
  const clock = new ManualClock()
  const transport = new HermesTransport({
    timers: clock.timers,
    random: () => 0,
    connectTimeoutMs: CONNECT_TIMEOUT,
    ...options
  })
  const states: ConnectionState[] = []
  transport.onConnectionChange(state => states.push(state))
  // Every scheduled delay except the per-socket handshake timeout.
  const backoff = () => clock.delays.filter(ms => ms !== CONNECT_TIMEOUT)
  return { clock, transport, states, backoff }
}

async function openLatest() {
  FakeWebSocket.instances.at(-1)!.open()
  await ManualClock.flush()
}

function sentIds(socket: FakeWebSocket): string[] {
  return socket.sent.map(frame => JSON.parse(frame).id as string)
}

describe('HermesTransport', () => {
  it('resolves a request when a frame with the matching id/result arrives', async () => {
    const { transport, socket } = await connect()
    const call = transport.rpc<{ ok: boolean }>('session.start', { profile: 'default' })
    const id = sentIds(socket)[0]
    socket.deliver({ jsonrpc: '2.0', id, result: { ok: true } })
    await expect(call).resolves.toEqual({ ok: true })
  })

  it('rejects with a HermesRpcError preserving the numeric code and message', async () => {
    const { transport, socket } = await connect()
    const call = transport.rpc('session.start')
    const id = sentIds(socket)[0]
    socket.deliver({ jsonrpc: '2.0', id, error: { code: -32601, message: 'unknown method' } })
    await expect(call).rejects.toMatchObject({
      name: 'HermesRpcError',
      code: -32601,
      message: 'unknown method'
    })
    await call.catch(error => expect(error).toBeInstanceOf(HermesRpcError))
  })

  it('defaults a non-numeric error code to 0 and supplies a fallback message', async () => {
    const { transport, socket } = await connect()
    const call = transport.rpc('session.start')
    const id = sentIds(socket)[0]
    socket.deliver({ jsonrpc: '2.0', id, error: { code: 'boom' } })
    await expect(call).rejects.toMatchObject({ code: 0, message: 'Hermes RPC failed' })
  })

  it('fans out event notifications, including message.delta, to every listener', async () => {
    const { transport, socket } = await connect()
    const a: GatewayEvent[] = []
    const b: GatewayEvent[] = []
    transport.onEvent(event => a.push(event))
    transport.onEvent(event => b.push(event))
    const delta = { type: 'message.delta', session_id: 's1', payload: { text: 'hi' } }
    socket.deliver({ jsonrpc: '2.0', method: 'event', params: delta })
    expect(a).toEqual([delta])
    expect(b).toEqual(a)
  })

  it('stops delivering to a listener after its unsubscribe is called', async () => {
    const { transport, socket } = await connect()
    const seen: GatewayEvent[] = []
    const off = transport.onEvent(event => seen.push(event))
    off()
    socket.deliver({ jsonrpc: '2.0', method: 'event', params: { type: 'message.delta' } })
    expect(seen).toEqual([])
  })

  it('ignores unmatched, malformed, and non-event frames without throwing', async () => {
    const { transport, socket } = await connect()
    const events: GatewayEvent[] = []
    transport.onEvent(event => events.push(event))
    socket.deliver({ jsonrpc: '2.0', id: 'business-999', result: {} }) // no pending
    socket.deliver('not json at all {')
    socket.deliver({ jsonrpc: '2.0', method: 'event', params: {} }) // no type
    socket.deliver({ jsonrpc: '2.0', method: 'log', params: { type: 'noise' } })
    expect(events).toEqual([])
    // The transport is still healthy after the noise.
    const call = transport.rpc('ping')
    socket.deliver({ jsonrpc: '2.0', id: sentIds(socket)[0], result: 'pong' })
    await expect(call).resolves.toBe('pong')
  })

  it('correlates multiple concurrent requests to their own results', async () => {
    const { transport, socket } = await connect()
    const first = transport.rpc<number>('a')
    const second = transport.rpc<number>('b')
    const third = transport.rpc<number>('c')
    const [idA, idB, idC] = sentIds(socket)
    expect(new Set([idA, idB, idC]).size).toBe(3)
    socket.deliver({ jsonrpc: '2.0', id: idC, result: 3 })
    socket.deliver({ jsonrpc: '2.0', id: idA, result: 1 })
    socket.deliver({ jsonrpc: '2.0', id: idB, result: 2 })
    await expect(Promise.all([first, second, third])).resolves.toEqual([1, 2, 3])
  })

  it('reflects connection state and refuses rpc when the socket is not open', async () => {
    const transport = new HermesTransport({ autoReconnect: false })
    await expect(transport.rpc('early')).rejects.toThrow('Hermes is not connected')
    const opened = transport.connect(URL)
    const socket = FakeWebSocket.instances.at(-1)!
    socket.open()
    await opened
    expect(transport.connected).toBe(true)
    socket.close()
    expect(transport.connected).toBe(false)
    await expect(transport.rpc('late')).rejects.toThrow('Hermes is not connected')
  })

  it('rejects connect when the socket reports an error before opening', async () => {
    const transport = new HermesTransport()
    const opened = transport.connect(URL)
    FakeWebSocket.instances.at(-1)!.fail()
    await expect(opened).rejects.toThrow('Could not connect to Hermes')
  })

  it('is idempotent: a second connect on an open socket makes no new socket', async () => {
    const { transport } = await connect()
    expect(FakeWebSocket.instances).toHaveLength(1)
    await transport.connect(URL)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('joins an in-flight handshake instead of opening a second socket', async () => {
    const transport = new HermesTransport()
    const first = transport.connect(URL)
    const second = transport.connect(URL)
    expect(FakeWebSocket.instances).toHaveLength(1)
    FakeWebSocket.instances[0].open()
    await Promise.all([first, second])
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(transport.connected).toBe(true)
  })

  describe('recovery', () => {
    it('rejects every in-flight request when the socket closes', async () => {
      const { transport } = makeClocked()
      const opened = transport.connect(URL)
      await openLatest()
      await opened
      const first = transport.rpc('a')
      const second = transport.rpc('b')
      FakeWebSocket.instances.at(-1)!.close()
      await expect(first).rejects.toBeInstanceOf(HermesConnectionClosedError)
      await expect(second).rejects.toThrow('Hermes connection closed')
    })

    it('reports closed then reconnecting, and open again once the gateway returns', async () => {
      const { clock, transport, states } = makeClocked()
      const opened = transport.connect(URL)
      await openLatest()
      await opened
      FakeWebSocket.instances.at(-1)!.close()
      await clock.advance(500)
      await openLatest()
      expect(states).toEqual(['open', 'closed', 'reconnecting', 'open'])
      expect(transport.connectionState).toBe('open')
    })

    it('retries with capped exponential backoff (500ms -> 8s) while the gateway is down', async () => {
      const { clock, transport, backoff } = makeClocked()
      const opened = transport.connect(URL)
      await openLatest()
      await opened
      FakeWebSocket.instances.at(-1)!.close()
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const before = FakeWebSocket.instances.length
        const delays = backoff()
        await clock.advance(delays[delays.length - 1])
        expect(FakeWebSocket.instances).toHaveLength(before + 1)
        FakeWebSocket.instances.at(-1)!.fail()
        await ManualClock.flush()
      }
      expect(backoff().slice(0, 7)).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000])
      expect(transport.connectionState).toBe('reconnecting')
    })

    it('adds jitter on top of the capped delay', async () => {
      const { transport, backoff } = makeClocked({ random: () => 1, jitter: 0.25 })
      const opened = transport.connect(URL)
      await openLatest()
      await opened
      FakeWebSocket.instances.at(-1)!.close()
      expect(backoff()).toEqual([625]) // 500 * (1 + 0.25)
    })

    it('serves rpc again after a transparent reconnect', async () => {
      const { clock, transport } = makeClocked()
      const opened = transport.connect(URL)
      await openLatest()
      await opened
      FakeWebSocket.instances.at(-1)!.close()
      await expect(transport.rpc('while-down')).rejects.toThrow('Hermes is not connected')
      await clock.advance(500)
      await openLatest()
      expect(transport.connected).toBe(true)
      const socket = FakeWebSocket.instances.at(-1)!
      const call = transport.rpc<string>('after-reconnect')
      socket.deliver({ jsonrpc: '2.0', id: sentIds(socket)[0], result: 'pong' })
      await expect(call).resolves.toBe('pong')
      expect(FakeWebSocket.instances).toHaveLength(2)
    })

    it('keeps event subscriptions alive across a reconnect', async () => {
      const { clock, transport } = makeClocked()
      const opened = transport.connect(URL)
      await openLatest()
      await opened
      const seen: GatewayEvent[] = []
      transport.onEvent(event => seen.push(event))
      FakeWebSocket.instances.at(-1)!.close()
      await clock.advance(500)
      await openLatest()
      FakeWebSocket.instances
        .at(-1)!
        .deliver({ jsonrpc: '2.0', method: 'event', params: { type: 'message.delta' } })
      expect(seen).toEqual([{ type: 'message.delta' }])
    })

    it('never retries a socket that failed before it ever opened (no gateway, demo, bad url)', async () => {
      const { clock, transport, states } = makeClocked()
      const opened = transport.connect(URL)
      FakeWebSocket.instances.at(-1)!.fail()
      await expect(opened).rejects.toThrow('Could not connect to Hermes')
      await clock.advance(60_000)
      expect(FakeWebSocket.instances).toHaveLength(1)
      expect(states).toEqual([])
    })

    it('stops retrying and fails in-flight work on an intentional close', async () => {
      const { clock, transport } = makeClocked()
      const opened = transport.connect(URL)
      await openLatest()
      await opened
      const call = transport.rpc('a')
      transport.close()
      await expect(call).rejects.toBeInstanceOf(HermesConnectionClosedError)
      await clock.advance(60_000)
      expect(FakeWebSocket.instances).toHaveLength(1)
      expect(transport.connectionState).toBe('closed')
    })

    it('waitForConnection resolves true once the gateway answers again', async () => {
      const { clock, transport } = makeClocked()
      const opened = transport.connect(URL)
      await openLatest()
      await opened
      FakeWebSocket.instances.at(-1)!.close()
      const waiting = transport.waitForConnection({ timeoutMs: 30_000, pollMs: 500 })
      await ManualClock.flush()
      await openLatest()
      await expect(waiting).resolves.toBe(true)
    })

    it('waitForConnection resolves false — without a socket storm — when nothing answers', async () => {
      const { clock, transport } = makeClocked()
      const opened = transport.connect(URL)
      await openLatest()
      await opened
      FakeWebSocket.instances.at(-1)!.close()
      const waiting = transport.waitForConnection({ timeoutMs: 2_000, pollMs: 500 })
      await clock.advance(2_500)
      await expect(waiting).resolves.toBe(false)
      // One replacement socket that never answered — no per-poll socket churn.
      expect(FakeWebSocket.instances).toHaveLength(2)
      // ...and giving up on the bounded wait leaves background recovery armed.
      expect(transport.connectionState).toBe('reconnecting')
      await clock.advance(120_000)
      expect(FakeWebSocket.instances.length).toBeGreaterThan(2)
    })
  })
})
