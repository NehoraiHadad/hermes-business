// Loaded as the FIRST import of every src/**/*.test.tsx (enforced by
// src/test/dom-conventions.test.ts). Runs before any app module, so the
// hermes bridge double exists before the hermes-client singleton is built —
// otherwise resolveClientMode() would silently fall back to DEMO fixtures
// under vitest (import.meta.env.DEV is true).
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { installBridge, resetBridge } from './hermes-bridge'

// Mirror index.html (<html lang="he" dir="rtl">) — jsdom does not load it.
document.documentElement.lang = 'he'
document.documentElement.dir = 'rtl'

installBridge()

afterEach(() => {
  cleanup() // RTL auto-cleanup is OFF without vitest globals — must be explicit
  resetBridge() // back to fail-closed defaults + clear vi.fn call state
  localStorage.clear()
})
