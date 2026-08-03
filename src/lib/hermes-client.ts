import { resolveClientMode } from './hermes/core'
import { createHermesCommands, type HermesCommands } from './hermes/command'
import { createDemoBackend, type DemoBackend } from './hermes/demo'
import { createHermesDesktop, type HermesDesktopApi } from './hermes/desktop'
import { createHermesRest, type HermesRest, type HermesUpdateStatus } from './hermes/rest'
import { createHermesSessions, type HermesSessions } from './hermes/session'
import {
  HermesTransport,
  type ConnectionListener,
  type ConnectionState,
  type EventListener
} from './hermes/transport'

export type { HermesUpdateStatus, ConnectionState }

type ClientModeContext = Parameters<typeof resolveClientMode>[0]

// Coherent public facade over the split transport/session/rest/desktop/demo modules.
// The rest of the app depends only on this surface and the exported singleton, so
// demo-vs-bridge-vs-missing is decided HERE and product code never branches on it.
export interface HermesClient extends HermesSessions, HermesRest, HermesCommands, HermesDesktopApi {}

export class HermesClient {
  readonly demo: boolean
  // True when we cannot serve real data and refuse to fabricate: a production
  // build whose preload bridge is absent. Callers surface this as an error.
  readonly bridgeMissing: boolean
  private transport: HermesTransport
  private demoBackend?: DemoBackend

  // Both seams exist for tests only; the shipped singleton takes the defaults
  // (real transport, real runtime-derived mode).
  constructor(options: { transport?: HermesTransport; mode?: ClientModeContext } = {}) {
    this.transport = options.transport ?? new HermesTransport()
    const mode = resolveClientMode(options.mode)
    this.demo = mode.demo
    this.bridgeMissing = mode.bridgeMissing
    // Only instantiate the fixture backend when demo is actually active, so the
    // fabricated data has no code path to reach a production user.
    if (this.demo) this.demoBackend = createDemoBackend()
    Object.assign(
      this,
      createHermesSessions((method, params) => this.rpc(method, params)),
      createHermesCommands((method, params) => this.rpc(method, params)),
      createHermesRest(
        (endpoint, init) => this.api(endpoint, init),
        () => window.hermesDesktop?.ensureGateway() || Promise.resolve(),
        window.hermesDesktop?.applyUpdate
          ? () => window.hermesDesktop!.applyUpdate()
          : undefined,
        // Real out-of-band credential probe (Anthropic etc.) runs in the main process to
        // avoid browser CORS and keep the key off the renderer network. Absent in demo/
        // browser → connectProvider fails honestly for un-probeable providers.
        window.hermesDesktop?.probeProvider
          ? input => window.hermesDesktop!.probeProvider!(input)
          : undefined
      ),
      // Main-process surface (Google OAuth, WhatsApp policy/guard, curator, provider
      // evidence, runtime lifecycle, OS shell). Same three-mode contract as rpc()/api():
      // bridge → delegate, demo → fixture, missing bridge → throw honestly.
      createHermesDesktop(() => window.hermesDesktop, this.demoBackend?.desktop)
    )
  }

  async boot() {
    if (this.demo) {
      return {
        installed: true,
        running: true,
        starting: false,
        mode: 'demo',
        version: '0.19.0',
        error: null,
        wsUrl: ''
      } satisfies HermesRuntime
    }
    if (this.bridgeMissing) {
      return {
        installed: false,
        running: false,
        starting: false,
        mode: 'error',
        version: null,
        error: 'גשר שולחן העבודה של Hermes אינו זמין. סגור ופתח את היישום מחדש.',
        wsUrl: ''
      } satisfies HermesRuntime
    }
    const runtime = await window.hermesDesktop!.startRuntime()
    if (runtime.running) await this.transport.connect(runtime.wsUrl)
    return runtime
  }

  onEvent(listener: EventListener) {
    return this.transport.onEvent(listener)
  }

  // Connection lifecycle for the UI. Demo/no-bridge sessions never open a socket,
  // so they never emit — callers must treat "no event" as "nothing to recover".
  onConnectionChange(listener: ConnectionListener) {
    return this.transport.onConnectionChange(listener)
  }

  // Demo has no socket to lose; the fixture backend is always usable.
  get connected(): boolean {
    if (this.demo) return true
    return this.transport.connected
  }

  get connectionState(): ConnectionState {
    if (this.demo) return 'open'
    return this.transport.connectionState
  }

  connect(wsUrl: string) {
    return this.transport.connect(wsUrl)
  }

  // Bounded, evidence-based wait: resolves true only when rpc() will actually
  // work again. Never true for a missing bridge — that cannot recover in-process.
  async waitForConnection(opts: { wsUrl?: string; timeoutMs?: number; pollMs?: number } = {}) {
    if (this.demo) return true
    if (this.bridgeMissing) return false
    return this.transport.waitForConnection(opts)
  }

  // Intentional teardown: stops reconnection and fails in-flight requests.
  disconnect() {
    this.transport.close()
  }

  async rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.demo) return this.demoBackend!.rpc<T>(method, params, event => this.transport.emit(event))
    if (this.bridgeMissing) throw new Error('Hermes desktop bridge is unavailable')
    return this.transport.rpc<T>(method, params)
  }

  async api<T>(endpoint: string, init?: { method?: string; body?: unknown }): Promise<T> {
    if (this.demo) return this.demoBackend!.api<T>(endpoint, init)
    if (this.bridgeMissing) throw new Error('Hermes desktop bridge is unavailable')
    return window.hermesDesktop!.api<T>(endpoint, init)
  }
}

export const hermesClient = new HermesClient()
