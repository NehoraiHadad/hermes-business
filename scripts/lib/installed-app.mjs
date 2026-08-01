// Playwright/Electron harness helpers for the installed-companion E2E suites.
// Imports playwright-core (via installed-launch), so only the installed-app
// suites should import this. This facade re-exports the launch, gateway-RPC and
// UI-locator concerns so existing importers are unchanged.

export {
  tempUserDataDir,
  launchInstalledApp,
  openFirstWindow,
  readRuntimeState,
  waitForRuntimeRunning
} from './installed-launch.mjs'

export { gatewayRpc, listSessions, findSessionByMarker } from './installed-rpc.mjs'

export { elicitAndDenyApproval } from './installed-approval.mjs'

export { navigateScreen, composerLocator, stopButtonLocator } from './installed-ui.mjs'
