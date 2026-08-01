// Faithful in-memory WebSocket double for transport tests: no network, no
// timers of its own. It mirrors the browser surface HermesTransport touches
// (readyState + OPEN/CLOSED, once-scoped addEventListener, send, close) and
// exposes test drivers (open/error/deliver) plus a live listener count so
// tests can assert cleanup without reaching into transport internals.
type Entry = { fn: (ev: unknown) => void; once: boolean }

export class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly url: string
  readyState: number = FakeWebSocket.CONNECTING
  readonly sent: string[] = []
  private readonly listeners = new Map<string, Set<Entry>>()

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, fn: (ev: unknown) => void, opts?: { once?: boolean }) {
    const set = this.listeners.get(type) ?? new Set<Entry>()
    set.add({ fn, once: Boolean(opts?.once) })
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, fn: (ev: unknown) => void) {
    const set = this.listeners.get(type)
    if (!set) return
    for (const entry of set) if (entry.fn === fn) set.delete(entry)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.dispatch('close', {})
  }

  // --- test drivers -------------------------------------------------------
  open() {
    this.readyState = FakeWebSocket.OPEN
    this.dispatch('open', {})
  }

  fail() {
    this.dispatch('error', {})
  }

  deliver(data: unknown) {
    this.dispatch('message', { data: typeof data === 'string' ? data : JSON.stringify(data) })
  }

  get listenerCount(): number {
    let total = 0
    for (const set of this.listeners.values()) total += set.size
    return total
  }

  private dispatch(type: string, ev: unknown) {
    const set = this.listeners.get(type)
    if (!set) return
    for (const entry of [...set]) {
      if (entry.once) set.delete(entry)
      entry.fn(ev)
    }
  }
}
