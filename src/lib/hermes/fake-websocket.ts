// Test doubles for the transport layer: a faithful in-memory WebSocket, and a
// manual clock for the reconnect schedule.
//
// FakeWebSocket has no network and no timers of its own. It mirrors the browser
// surface HermesTransport touches (readyState + OPEN/CLOSED, once-scoped
// addEventListener/removeEventListener, send, close) and exposes test drivers
// (open/fail/deliver) plus a live listener count so tests can assert cleanup
// without reaching into transport internals.
import type { TransportTimers } from './transport'

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

type Task = { at: number; fn: () => void }

// Deterministic clock injected as HermesTransport's timers. Real timers are left
// untouched (so `flush` can drain the microtask queue), and every scheduled
// delay is recorded, which is how backoff is asserted without private access.
export class ManualClock {
  now = 0
  readonly delays: number[] = []
  private seq = 0
  private tasks = new Map<number, Task>()

  readonly timers: TransportTimers = {
    setTimeout: (fn: () => void, ms: number) => {
      const id = ++this.seq
      this.delays.push(ms)
      this.tasks.set(id, { at: this.now + ms, fn })
      return id as unknown as ReturnType<typeof setTimeout>
    },
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => {
      this.tasks.delete(handle as unknown as number)
    },
    now: () => this.now
  }

  // Let queued promise callbacks settle between simulated ticks.
  static flush(): Promise<void> {
    return new Promise<void>(resolve => setTimeout(resolve, 0))
  }

  async advance(ms: number) {
    const target = this.now + ms
    for (;;) {
      let dueId = -1
      let dueAt = Number.POSITIVE_INFINITY
      for (const [id, task] of this.tasks) {
        if (task.at <= target && task.at < dueAt) {
          dueAt = task.at
          dueId = id
        }
      }
      if (dueId < 0) break
      const task = this.tasks.get(dueId)!
      this.tasks.delete(dueId)
      this.now = task.at
      task.fn()
      await ManualClock.flush()
    }
    this.now = target
    await ManualClock.flush()
  }
}
