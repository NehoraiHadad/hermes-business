import type { GatewayEvent } from '../src/types'
export class HermesServerRequests {
  constructor(send: (frame: Record<string, unknown>) => void, emit: (event: GatewayEvent) => void)
  advertise(): void
  accept(frame: { id?: unknown; method?: string; params?: Record<string, unknown> }): boolean
  respond(id: string, result: Record<string, unknown>): void
  cancel(payload: Record<string, unknown>): void
  replay(result: unknown): void
  reset(): void
}
