// Renderer + main-process ISOLATION PROOFS for the real-loader E2E, the
// localStorage preseed (installed via an init script BEFORE first navigation so
// the app never makes a session/provider call), and the companion-backend network
// observer. All isolation assertions run BEFORE any UI claim so a silent isolation
// failure aborts the run instead of mutating the live profile.

import path from 'node:path'

// Plugin storage key (installed apps/desktop/src/contrib/plugin.ts::createPluginStorage
// -> `hermes.plugin.<id>.<key>`). Marking guided setup complete stops BusinessShell's
// mount effect from auto-launching agent-led onboarding in the isolated home.
export const PLUGIN_GUIDED_KEY = 'hermes.plugin.business-shell.guidedSetup'
export const GUIDED_SETUP_VERSION = 2
// Desktop onboarding cache keys (installed apps/desktop/src/store/onboarding.ts).
export const ONBOARDED_KEY = 'hermes-desktop-onboarded-v1'
export const ONBOARDING_SKIPPED_KEY = 'hermes-onboarding-skipped-v1'

export const PRESEED_PAYLOAD = Object.freeze({
  [PLUGIN_GUIDED_KEY]: JSON.stringify({ version: GUIDED_SETUP_VERSION, status: 'complete' }),
  [ONBOARDED_KEY]: '1',
  [ONBOARDING_SKIPPED_KEY]: '1'
})

/** Case/separator-insensitive path equality (Windows-safe). */
export function samePath(a, b) {
  if (!a || !b) return false
  const key = p => path.resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase()
  return key(a) === key(b)
}

/**
 * Install the preseed as a context init script so it runs BEFORE the page's own
 * scripts on every navigation. Returns nothing; assertPreseeded verifies it took.
 * Throws if the Electron context does not support addInitScript (fail honestly —
 * we then cannot guarantee onboarding is suppressed).
 */
export async function installPreseedInitScript(context) {
  if (!context || typeof context.addInitScript !== 'function') {
    throw new Error('Electron context does not support addInitScript; cannot preseed before first navigation')
  }
  await context.addInitScript(payload => {
    try {
      for (const [k, v] of Object.entries(payload)) localStorage.setItem(k, v)
    } catch {
      /* origin without storage; assertPreseeded will catch the miss */
    }
  }, PRESEED_PAYLOAD)
}

/**
 * Read back the preseeded values AFTER a reload and prove every expected key holds
 * the expected value. Throws (fail honestly) on any mismatch so a preseed that did
 * not take can never be silently ignored. Returns the read-back map on success.
 */
export async function assertPreseeded(page) {
  const values = await page.evaluate(
    keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])),
    Object.keys(PRESEED_PAYLOAD)
  )
  const missing = Object.entries(PRESEED_PAYLOAD).filter(([k, v]) => values[k] !== v).map(([k]) => k)
  if (missing.length) {
    throw new Error(`preseed init script did not take for: ${missing.join(', ')} :: ${JSON.stringify(values)}`)
  }
  return values
}

/**
 * Prove the launched app's MAIN process resolved the ISOLATED HERMES_HOME, read
 * from the preload bridge (main-process truth, not the env we passed in):
 *   window.hermesDesktop.desktopPluginsRoot() === <isoHome>/desktop-plugins
 * A match proves the app is pointed at our throwaway home and plugin door, not the
 * live profile. Throws (fail closed) on mismatch.
 */
export async function proveMainHomeIsolation(page, { isoHome }) {
  const pluginRoot = await page.evaluate(() => window.hermesDesktop?.desktopPluginsRoot?.())
  const expectedPluginRoot = path.join(isoHome, 'desktop-plugins')
  const values = { pluginRoot, expectedPluginRoot }
  if (!samePath(pluginRoot, expectedPluginRoot)) {
    throw new Error(`main-process HERMES_HOME isolation proof failed :: ${JSON.stringify(values)}`)
  }
  return { checks: { plugin_root_isolated: true, main_hermes_home_isolated: true }, values }
}

/**
 * Attach a page-level observer for the namespaced companion-backend responses.
 * Captures status + body for any URL containing `pathFragment`. Renderer-issued
 * fetches are seen here; a main-process fetch would not be — so this is a BONUS
 * attestation, not the mandatory proof (the rendered paused row is that).
 */
export function observeBackendResponse(page, { pathFragment }) {
  const hits = []
  page.on('response', async res => {
    let url = ''
    try {
      url = res.url()
    } catch {
      return
    }
    if (!url.includes(pathFragment)) return
    let body = null
    try {
      body = await res.text()
    } catch {
      /* body may be unavailable */
    }
    hits.push({ url, status: res.status(), body })
  })
  return {
    hits,
    matched2xx() {
      return hits.find(h => h.status >= 200 && h.status < 300) || null
    },
    pausedSupportedBody() {
      return hits.find(h => h.body && h.body.includes('paused_listing_supported') && /true/.test(h.body)) || null
    }
  }
}
