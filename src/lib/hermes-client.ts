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
  private transport = new HermesTransport()
  private demoBackend: DemoBackend = createDemoBackend()

  constructor() {
    this.demo = !window.hermesDesktop || new URLSearchParams(window.location.search).get('demo') === '1'
    Object.assign(
      this,
      createHermesSessions((method, params) => this.rpc(method, params)),
      createHermesRest((endpoint, init) => this.api(endpoint, init))
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
    if (this.demo) return this.demoBackend.rpc<T>(method, params, event => this.transport.emit(event))
    return this.transport.rpc<T>(method, params)
  }

  async api<T>(endpoint: string, init?: { method?: string; body?: unknown }): Promise<T> {
    if (this.demo) return this.demoBackend.api<T>(endpoint, init)
    return window.hermesDesktop!.api<T>(endpoint, init)
  }
}

export const hermesClient = new HermesClient()
