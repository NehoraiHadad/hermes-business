import { resolveClientMode } from './hermes/core'
import { createDemoBackend, type DemoBackend } from './hermes/demo'
import { createHermesRest, type HermesRest, type HermesUpdateStatus } from './hermes/rest'
import { createHermesSessions, type HermesSessions } from './hermes/session'
import { HermesTransport, type EventListener } from './hermes/transport'

export type { HermesUpdateStatus }

// Coherent public facade over the split transport/session/rest/demo modules.
// The rest of the app depends only on this surface and the exported singleton.
export interface HermesClient extends HermesSessions, HermesRest {}

export class HermesClient {
  readonly demo: boolean
  // True when we cannot serve real data and refuse to fabricate: a production
  // build whose preload bridge is absent. Callers surface this as an error.
  readonly bridgeMissing: boolean
  private transport = new HermesTransport()
  private demoBackend?: DemoBackend

  constructor() {
    const mode = resolveClientMode()
    this.demo = mode.demo
    this.bridgeMissing = mode.bridgeMissing
    // Only instantiate the fixture backend when demo is actually active, so the
    // fabricated data has no code path to reach a production user.
    if (this.demo) this.demoBackend = createDemoBackend()
    Object.assign(
      this,
      createHermesSessions((method, params) => this.rpc(method, params)),
      createHermesRest(
        (endpoint, init) => this.api(endpoint, init),
        () => window.hermesDesktop?.ensureGateway() || Promise.resolve(),
        window.hermesDesktop?.applyUpdate
          ? () => window.hermesDesktop!.applyUpdate()
          : undefined
      )
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

  connect(wsUrl: string) {
    return this.transport.connect(wsUrl)
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
