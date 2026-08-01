// Thin typed re-export of the canonical, cross-runtime provider readiness so the
// React/Electron wrapper and the Hermes plugin never drift. Logic lives in
// shared/provider-readiness.js; see shared/provider-readiness.d.ts for the types.
export type { ProviderReadiness, ProviderStatus } from '../../shared/provider-readiness'
export {
  resolveProviderReadiness,
  resolveProviderStatus,
  resolveModelReadiness
} from '../../shared/provider-readiness.js'
