import type { GatewayEvent } from '../../types'
import { HermesRpcError } from './core'

export type EventListener = (event: GatewayEvent) => void

// Coarse connection lifecycle, surfaced to callers so the UI can be honest about
// a dropped gateway instead of silently failing every later rpc().
export type ConnectionState = 'open' | 'closed' | 'reconnecting'
export type ConnectionListener = (state: ConnectionState) => void

// Raised for every in-flight request when the socket closes, so callers can tell
// "the gateway went away" apart from a genuine RPC rejection or a 120s timeout.
export class HermesConnectionClosedError extends Error {
  constructor(message = 'Hermes connection closed') {
    super(message)
    this.name = 'HermesConnectionClosedError'
  }
}

type TimerHandle = ReturnType<typeof setTimeout>

// Injected clock/timers keep the reconnect schedule testable without reaching
// into transport internals (and keep one spelling of setTimeout everywhere).
export type TransportTimers = {
  setTimeout: (fn: () => void, ms: number) => TimerHandle
  clearTimeout: (handle: TimerHandle) => void
  now: () => number
}

export type TransportOptions = {
  timers?: Partial<TransportTimers>
  /** Auto-reconnect after an unexpected close. Disable for tests/one-shot uses. */
  autoReconnect?: boolean
  /** First backoff delay; doubles up to `maxDelayMs`. */
  baseDelayMs?: number
  maxDelayMs?: number
  /** Fraction of the delay added as random jitter (0.25 => up to +25%). */
  jitter?: number
  random?: () => number
  connectTimeoutMs?: number
  requestTimeoutMs?: number
}

const DEFAULT_TIMERS: TransportTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => clearTimeout(handle),
  now: () => Date.now()
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: TimerHandle
}

// Low-level JSON-RPC transport over the Hermes dashboard WebSocket: connection
// lifecycle, request/response correlation, and event fan-out. Higher layers
// (session/prompt and REST helpers) build on top of this.
//
// Recovery contract: a socket that once reached OPEN is "armed". If it closes
// unexpectedly the transport rejects every in-flight request, reports 'closed',
// and retries the same URL with capped exponential backoff until it reconnects
// or close() is called. A connect() that never opened is NOT armed — an absent
// gateway (demo mode, missing bridge, wrong URL) therefore fails honestly to the
// caller instead of spinning a retry loop forever.
//
// Scope note: onEvent subscribers survive a reconnect (they live here, not on
// the socket), but Hermes binds each session to the CONNECTION it was created or
// resumed on (tui_gateway/server.py detaches a session's transport on
// disconnect, and only a `session.resume` re-binds a live one). So a new socket
// alone does not resume the event stream of a session started on the old one:
// on the 'open' that follows a 'closed'/'reconnecting', the chat layer must call
// session.resume for its active session. That re-subscription is deliberately
// left to the session/chat owner — this layer only reports the state change.
export class HermesTransport {
  private socket: WebSocket | null = null
  private listeners = new Set<EventListener>()
  private connectionListeners = new Set<ConnectionListener>()
  private pending = new Map<string, Pending>()
  private nextId = 0

  private url: string | null = null
  private connecting: Promise<void> | null = null
  private reconnectTimer: TimerHandle | null = null
  private reconnectAttempt = 0
  // Only a socket that actually opened earns automatic recovery.
  private armed = false
  private intentionallyClosed = false
  private state: ConnectionState = 'closed'

  private readonly timers: TransportTimers
  private readonly autoReconnect: boolean
  private readonly baseDelayMs: number
  private readonly maxDelayMs: number
  private readonly jitter: number
  private readonly random: () => number
  private readonly connectTimeoutMs: number
  private readonly requestTimeoutMs: number

  constructor(options: TransportOptions = {}) {
    this.timers = { ...DEFAULT_TIMERS, ...options.timers }
    this.autoReconnect = options.autoReconnect ?? true
    this.baseDelayMs = options.baseDelayMs ?? 500
    this.maxDelayMs = options.maxDelayMs ?? 8_000
    this.jitter = options.jitter ?? 0.25
    this.random = options.random ?? Math.random
    this.connectTimeoutMs = options.connectTimeoutMs ?? 15_000
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000
  }

  onEvent(listener: EventListener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  // Dedicated connection-state callback rather than a synthetic GatewayEvent:
  // GatewayEvent is the gateway's own wire vocabulary and must not be forged.
  onConnectionChange(listener: ConnectionListener) {
    this.connectionListeners.add(listener)
    return () => {
      this.connectionListeners.delete(listener)
    }
  }

  emit(event: GatewayEvent) {
    this.listeners.forEach(listener => listener(event))
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN
  }

  get connectionState(): ConnectionState {
    return this.state
  }

  async connect(wsUrl: string): Promise<void> {
    this.intentionallyClosed = false
    this.clearReconnectTimer()
    if (this.url === wsUrl && this.socket) {
      // Already OPEN, or a handshake is in flight: never race a second socket
      // against the first (the old guard only covered OPEN, so a call during
      // CONNECTING orphaned a live socket).
      if (this.socket.readyState === WebSocket.OPEN) return
      if (this.connecting) return this.connecting
    }
    // A different URL (or a dead socket) — drop the old one deliberately.
    this.discardSocket()
    this.url = wsUrl
    const socket = new WebSocket(wsUrl)
    this.socket = socket
    this.attachHandlers(socket)
    const handshake = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.timers.clearTimeout(timer)
        socket.removeEventListener('open', onOpen)
        socket.removeEventListener('error', onError)
        socket.removeEventListener('close', onClose)
      }
      const onOpen = () => {
        cleanup()
        this.armed = true
        this.reconnectAttempt = 0
        this.setState('open')
        resolve()
      }
      const onError = () => {
        cleanup()
        this.discardSocket(socket)
        reject(new Error('Could not connect to Hermes'))
      }
      // A socket can close during the handshake without ever raising 'error';
      // fail the connect immediately instead of waiting out the timeout.
      const onClose = () => {
        cleanup()
        reject(new Error('Could not connect to Hermes'))
      }
      const timer = this.timers.setTimeout(() => {
        cleanup()
        this.discardSocket(socket)
        reject(new Error('Hermes connection timed out'))
      }, this.connectTimeoutMs)
      socket.addEventListener('open', onOpen, { once: true })
      socket.addEventListener('error', onError, { once: true })
      socket.addEventListener('close', onClose, { once: true })
    })
    this.connecting = handshake
    try {
      await handshake
    } catch (error) {
      // A failed attempt must not silently disarm recovery for a gateway we
      // have already talked to once.
      this.resumeAutoReconnect()
      throw error
    } finally {
      if (this.connecting === handshake) this.connecting = null
    }
  }

  // Intentional shutdown (app teardown / deliberate disconnect): stop retrying
  // and fail anything still in flight rather than leaving it to the 120s timeout.
  close() {
    this.intentionallyClosed = true
    this.clearReconnectTimer()
    this.reconnectAttempt = 0
    this.armed = false
    this.discardSocket()
    this.failPending(new HermesConnectionClosedError())
    this.setState('closed')
  }

  // Bounded wait for a usable connection: true once rpc() will work again.
  // Used after a runtime restart so the UI can only claim success on proof.
  async waitForConnection(
    opts: { wsUrl?: string; timeoutMs?: number; pollMs?: number } = {}
  ): Promise<boolean> {
    const timeoutMs = opts.timeoutMs ?? 30_000
    const pollMs = opts.pollMs ?? 500
    const url = opts.wsUrl ?? this.url
    const deadline = this.timers.now() + timeoutMs
    for (;;) {
      if (this.connected) return true
      const remaining = deadline - this.timers.now()
      if (remaining <= 0) {
        // Giving up on the bounded wait must not end the background recovery.
        this.resumeAutoReconnect()
        return false
      }
      // Race the attempt against a poll slice so a socket that never answers
      // cannot stretch the wait past the caller's deadline. A repeat connect()
      // for the same URL joins the in-flight handshake instead of opening more.
      const slice = this.delay(Math.min(pollMs, remaining))
      if (url) await Promise.race([this.connect(url).catch(() => undefined), slice])
      else await slice
    }
  }

  async rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Hermes is not connected')
    }
    const id = `business-${++this.nextId}`
    return new Promise<T>((resolve, reject) => {
      const timer = this.timers.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Hermes request timed out: ${method}`))
      }, this.requestTimeoutMs)
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer })
      this.socket!.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  // --- internals ----------------------------------------------------------

  private attachHandlers(socket: WebSocket) {
    socket.addEventListener('message', message => {
      if (socket !== this.socket) return
      try {
        const frame = JSON.parse(String(message.data))
        if (frame.id != null) {
          const pending = this.pending.get(String(frame.id))
          if (!pending) return
          this.timers.clearTimeout(pending.timer)
          this.pending.delete(String(frame.id))
          if (frame.error)
            pending.reject(
              new HermesRpcError(
                frame.error.message || 'Hermes RPC failed',
                typeof frame.error.code === 'number' ? frame.error.code : 0
              )
            )
          else pending.resolve(frame.result)
        } else if (frame.method === 'event' && frame.params?.type) {
          this.emit(frame.params)
        }
      } catch {
        // Ignore malformed frames from unrelated dev tooling.
      }
    })
    socket.addEventListener('close', () => {
      if (socket !== this.socket) return
      this.socket = null
      this.connecting = null
      // Everything in flight died with the socket: reject now instead of
      // letting each request hang until its 120s timeout.
      this.failPending(new HermesConnectionClosedError())
      this.setState('closed')
      if (this.intentionallyClosed || !this.armed || !this.autoReconnect) return
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect() {
    if (this.reconnectTimer != null || this.intentionallyClosed || !this.url) return
    const delay = this.backoffDelay(this.reconnectAttempt)
    this.reconnectAttempt += 1
    this.setState('reconnecting')
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = null
      void this.attemptReconnect()
    }, delay)
  }

  private async attemptReconnect() {
    const url = this.url
    if (!url || this.intentionallyClosed) return
    try {
      await this.connect(url)
    } catch {
      // The retry socket never opened; its own 'close' is ignored as stale, so
      // the next attempt is scheduled here.
      this.scheduleReconnect()
    }
  }

  private backoffDelay(attempt: number): number {
    const capped = Math.min(this.baseDelayMs * 2 ** attempt, this.maxDelayMs)
    return Math.round(capped * (1 + this.jitter * this.random()))
  }

  // Re-arm background recovery after a foreground attempt (connect /
  // waitForConnection) gave up, so a transport that once worked never ends up
  // permanently dead with nothing scheduled.
  private resumeAutoReconnect() {
    if (!this.autoReconnect || this.intentionallyClosed || !this.armed) return
    if (this.connected || this.reconnectTimer != null) return
    this.scheduleReconnect()
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer == null) return
    this.timers.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  // Detach and close a socket we no longer own. Nulling `this.socket` first makes
  // its later 'close'/'message' events stale, so they cannot restart the loop.
  private discardSocket(only?: WebSocket) {
    const socket = this.socket
    if (!socket || (only && socket !== only)) return
    this.socket = null
    this.connecting = null
    try {
      socket.close()
    } catch {
      // Closing an already-dead socket is not an error worth surfacing.
    }
  }

  private failPending(error: Error) {
    if (!this.pending.size) return
    const entries = [...this.pending.values()]
    this.pending.clear()
    for (const entry of entries) {
      this.timers.clearTimeout(entry.timer)
      entry.reject(error)
    }
  }

  private setState(next: ConnectionState) {
    if (this.state === next) return
    this.state = next
    this.connectionListeners.forEach(listener => listener(next))
  }

  private delay(ms: number) {
    return new Promise<void>(resolve => {
      this.timers.setTimeout(() => resolve(), ms)
    })
  }
}
