import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HermesTransport } from './transport'
import { HermesRpcError } from './core'
import type { GatewayEvent } from '../../types'
import { FakeWebSocket } from './fake-websocket'

// Drive the transport against a faithful fake socket, asserting only public
// behavior (rpc/onEvent/connected) rather than private maps or timers.
beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.stubGlobal('window', {
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id)
  })
})

afterEach(() => vi.unstubAllGlobals())

async function connect() {
  const transport = new HermesTransport()
  const opened = transport.connect('ws://hermes/dashboard')
  const socket = FakeWebSocket.instances.at(-1)!
  socket.open()
  await opened
  return { transport, socket }
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
    const transport = new HermesTransport()
    await expect(transport.rpc('early')).rejects.toThrow('Hermes is not connected')
    const opened = transport.connect('ws://hermes/dashboard')
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
    const opened = transport.connect('ws://hermes/dashboard')
    FakeWebSocket.instances.at(-1)!.fail()
    await expect(opened).rejects.toThrow('Could not connect to Hermes')
  })

  it('is idempotent: a second connect on an open socket makes no new socket', async () => {
    const { transport } = await connect()
    expect(FakeWebSocket.instances).toHaveLength(1)
    await transport.connect('ws://hermes/dashboard')
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})
