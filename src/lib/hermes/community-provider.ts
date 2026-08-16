import { createProviderApi, type HermesProviderApi } from './providers'

// Reuse the exact Hermes provider catalog/device-flow/model-selection client,
// changing only its REST transport. Tokens are therefore issued and persisted
// by the separate community HERMES_HOME; no credential file crosses roots.
export function createCommunityProviderApi(
  bridge: Pick<HermesDesktopBridge, 'communityApi'>
): HermesProviderApi {
  return createProviderApi((endpoint, init) => bridge.communityApi(endpoint, init))
}
