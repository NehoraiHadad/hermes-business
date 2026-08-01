import { describe, expect, it } from 'vitest'
import { isDemoBuildAllowed, resolveClientMode } from './hermes/core'

// Demo-fixture policy: `?demo=1` is honored ONLY where the build allows demo
// (dev server or an explicit QA/test build); a normal packaged production
// release ignores it and fails closed instead of ever fabricating data.
describe('resolveClientMode', () => {
  it('uses the real bridge when present and no explicit demo (dev or prod)', () => {
    expect(resolveClientMode({ hasBridge: true, explicitDemo: false, isDev: true })).toEqual({
      demo: false,
      bridgeMissing: false
    })
    expect(resolveClientMode({ hasBridge: true, explicitDemo: false, isDev: false, demoAllowed: false })).toEqual({
      demo: false,
      bridgeMissing: false
    })
  })

  it('HARD-DISABLES ?demo=1 in a normal packaged production release', () => {
    // isDev false + no QA/test build flag: the URL opt-in is inert, so the app
    // uses the real bridge and never touches the fixture backend.
    expect(resolveClientMode({ hasBridge: true, explicitDemo: true, isDev: false, demoAllowed: false })).toEqual({
      demo: false,
      bridgeMissing: false
    })
  })

  it('honors ?demo=1 only in an explicit QA/test build (installed demo e2e)', () => {
    // A dedicated build baked with VITE_ALLOW_DEMO — never the shipping release.
    expect(resolveClientMode({ hasBridge: true, explicitDemo: true, isDev: false, demoAllowed: true })).toEqual({
      demo: true,
      bridgeMissing: false
    })
  })

  it('falls back to demo implicitly only in a dev session without a bridge', () => {
    expect(resolveClientMode({ hasBridge: false, explicitDemo: false, isDev: true })).toEqual({
      demo: true,
      bridgeMissing: false
    })
  })

  it('fails closed in packaged production when the preload bridge is missing', () => {
    expect(resolveClientMode({ hasBridge: false, explicitDemo: false, isDev: false, demoAllowed: false })).toEqual({
      demo: false,
      bridgeMissing: true
    })
  })
})

// The runtime capability gate: dev always allows; production allows ONLY when an
// explicit QA/test build baked VITE_ALLOW_DEMO. Fixtures are ALSO physically
// stripped from a non-demo bundle by vite.config.ts (stripDemoFixtures); this
// gate governs whether the code path is reachable, that strip governs whether
// the fixtures ship at all.
describe('isDemoBuildAllowed', () => {
  it('allows demo in a dev server regardless of the flag', () => {
    expect(isDemoBuildAllowed({ DEV: true })).toBe(true)
  })

  it('forbids demo in a production build with no flag', () => {
    expect(isDemoBuildAllowed({ DEV: false })).toBe(false)
    expect(isDemoBuildAllowed({ DEV: false, VITE_ALLOW_DEMO: '' })).toBe(false)
    expect(isDemoBuildAllowed({ DEV: false, VITE_ALLOW_DEMO: 'false' })).toBe(false)
    expect(isDemoBuildAllowed({ DEV: false, VITE_ALLOW_DEMO: '0' })).toBe(false)
  })

  it('allows demo in a production build only when VITE_ALLOW_DEMO is explicitly set', () => {
    expect(isDemoBuildAllowed({ DEV: false, VITE_ALLOW_DEMO: '1' })).toBe(true)
    expect(isDemoBuildAllowed({ DEV: false, VITE_ALLOW_DEMO: 'true' })).toBe(true)
    expect(isDemoBuildAllowed({ DEV: false, VITE_ALLOW_DEMO: 'TRUE' })).toBe(true)
  })
})
