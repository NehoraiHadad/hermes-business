/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { stripDemoFixtures } from './scripts/strip-demo-fixtures.mjs'

export default defineConfig(({ mode, command }) => {
  // Demo is served only by the dev server or an explicit QA build (`--mode qa`).
  // Must stay in lockstep with isDemoBuildAllowed() in src/lib/hermes/core.ts.
  // stripDemoFixtures then physically removes the demo subtree from any bundle
  // that does not allow demo (see scripts/strip-demo-fixtures.mjs).
  const demoAllowed = command === 'serve' || mode === 'qa'
  return {
    base: './',
    plugins: [react(), stripDemoFixtures(demoAllowed)],
    // QA demo capability is derived from the explicit build mode, not an .env
    // file. This keeps credential-shaped files out of the repository while the
    // normal production build remains demo-disabled.
    define: {
      'import.meta.env.VITE_ALLOW_DEMO': JSON.stringify(mode === 'qa' ? 'true' : '')
    },
    server: {
      host: '127.0.0.1',
      port: 5173
    },
    build: {
      outDir: 'dist',
      sourcemap: true
    },
    test: {
      // Concurrent Claude Code sessions run in worktrees under .claude/ — their
      // test copies must never be collected by this checkout's vitest run.
      exclude: [...configDefaults.exclude, '**/.claude/**', '**/promo-video/**'],
      // Spawn-heavy suites (PowerShell/zip/python probes) exceed the 5s default
      // under parallel machine load; they pass in isolation well under this cap.
      testTimeout: 15000
    }
  }
})
