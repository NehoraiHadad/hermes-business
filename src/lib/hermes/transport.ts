import type { GatewayEvent } from '../../types'

export type EventListener = (event: GatewayEvent) => void

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

// Low-level JSON-RPC transport over the Hermes dashboard WebSocket: connection
// lifecycle, request/response correlation, and event fan-out. Higher layers
// (session/prompt and REST helpers) build on top of this.
export class HermesTransport {
  private socket: WebSocket | null = null
  private listeners = new Set<EventListener>()
  private pending = new Map<string, Pending>()
  private nextId = 0

  onEvent(listener: EventListener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(event: GatewayEvent) {
    this.listeners.forEach(listener => listener(event))
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN
  }

  async connect(wsUrl: string) {
    if (this.socket?.readyState === WebSocket.OPEN) return
    this.socket = new WebSocket(wsUrl)
    await new Promise<void>((resolve, reject) => {
      const socket = this.socket!
      const timer = window.setTimeout(() => reject(new Error('Hermes connection timed out')), 15_000)
      socket.addEventListener(
        'open',
        () => {
          window.clearTimeout(timer)
          resolve()
        },
        { once: true }
      )
      socket.addEventListener(
        'error',
        () => {
          window.clearTimeout(timer)
          reject(new Error('Could not connect to Hermes'))
        },
        { once: true }
      )
      socket.addEventListener('message', message => {
        try {
          const frame = JSON.parse(String(message.data))
          if (frame.id != null) {
            const pending = this.pending.get(String(frame.id))
            if (!pending) return
            clearTimeout(pending.timer)
            this.pending.delete(String(frame.id))
            if (frame.error) pending.reject(new Error(frame.error.message || 'Hermes RPC failed'))
            else pending.resolve(frame.result)
          } else if (frame.method === 'event' && frame.params?.type) {
            this.emit(frame.params)
          }
        } catch {
          // Ignore malformed frames from unrelated dev tooling.
        }
      })
    })
  }

  async rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Hermes is not connected')
    }
    const id = `business-${++this.nextId}`
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Hermes request timed out: ${method}`))
      }, 120_000)
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer })
      this.socket!.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }
}
