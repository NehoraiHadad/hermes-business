import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const originalHome = process.env.HERMES_HOME
const { __resetRuntimeModeCache, defaultLiveHome } = require('../../electron/runtime-mode.cjs') as {
  __resetRuntimeModeCache: () => void
  defaultLiveHome: (env?: NodeJS.ProcessEnv) => string
}

afterEach(() => {
  if (originalHome === undefined) delete process.env.HERMES_HOME
  else process.env.HERMES_HOME = originalHome
  __resetRuntimeModeCache()
})

describe('Electron Hermes discovery', () => {
  it('does not let an ambient HERMES_HOME redirect production', () => {
    process.env.HERMES_HOME = 'C:\\Temp\\hermes-business-e2e\\stale\\home'
    __resetRuntimeModeCache()
    const { hermesHome } = require('../../electron/paths.cjs') as { hermesHome: () => string }

    expect(hermesHome()).toBe(defaultLiveHome(process.env))
  })
})
