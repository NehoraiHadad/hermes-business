import { createRequire } from 'node:module'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const originalHome = process.env.HERMES_HOME

afterEach(() => {
  if (originalHome === undefined) delete process.env.HERMES_HOME
  else process.env.HERMES_HOME = originalHome
})

describe('Electron Hermes discovery', () => {
  it('does not reuse a global installation when HERMES_HOME is explicit', () => {
    process.env.HERMES_HOME = path.join(process.cwd(), '.tmp-hermes-home', 'definitely-missing')
    const { findHermes } = require('../../electron/paths.cjs') as { findHermes: () => string | null }

    expect(findHermes()).toBeNull()
  })
})
