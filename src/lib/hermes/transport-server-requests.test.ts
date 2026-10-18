import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HermesTransport } from './transport'
import { FakeWebSocket } from './fake-websocket'
import type { GatewayEvent } from '../../types'

beforeEach(() => { FakeWebSocket.instances = []; vi.stubGlobal('WebSocket', FakeWebSocket) })
afterEach(() => vi.unstubAllGlobals())
const request = { jsonrpc: '2.0', id: 'srq-123', method: 'approval', params: { session_id: 'session', command: 'test' } }

async function opened(transport = new HermesTransport({ autoReconnect: false })) {
  const pending = transport.connect('ws://test')
  const socket = FakeWebSocket.instances.at(-1)!
  socket.open()
  await pending
  return { transport, socket }
}

it('advertises native requests and sends a response to the native request id', async () => {
  const { transport, socket } = await opened()
  const events: GatewayEvent[] = []
  transport.onEvent(event => events.push(event))
  expect(JSON.parse(socket.sent[0])).toMatchObject({ method: 'client.capabilities', params: { server_requests: true } })
  socket.deliver(request)
  expect(events[0]).toMatchObject({ type: 'approval.request', payload: { request_id: 'srq-123' } })
  await transport.respondServerRequest('srq-123', { choice: 'deny' })
  expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ jsonrpc: '2.0', id: 'srq-123', result: { choice: 'deny' } })
  transport.close()
})

it('cancels stale cards on disconnect and restores native open requests on resume', async () => {
  const { transport, socket } = await opened()
  const events: GatewayEvent[] = []
  transport.onEvent(event => events.push(event))
  socket.deliver(request)
  socket.close()
  expect(events.at(-1)).toMatchObject({ type: 'request.cancel', payload: { id: 'srq-123' } })
  await expect(transport.respondServerRequest('srq-123', { choice: 'once' })).rejects.toThrow()
  const next = (await opened(transport)).socket
  const resumed = transport.rpc('session.resume', { session_id: 'session' })
  const id = JSON.parse(next.sent.at(-1)!).id
  next.deliver({ jsonrpc: '2.0', id, result: { session_id: 'session', open_requests: [request] } })
  await resumed
  expect(events.at(-1)).toMatchObject({ type: 'approval.request', payload: { request_id: 'srq-123' } })
  next.deliver({ method: 'event', params: { type: 'request.cancel', session_id: 'session', payload: { id: 'srq-123' } } })
  await expect(transport.respondServerRequest('srq-123', { choice: 'once' })).rejects.toThrow()
  transport.close()
})
