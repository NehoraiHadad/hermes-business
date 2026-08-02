import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { buildChildEnv } = require('./runtime-env.cjs') as {
  buildChildEnv: (input: {
    sessionToken: string
    override: { enabled: boolean; hermesHome?: string }
  }) => Record<string, string>
}

const originalHome = process.env.HERMES_HOME

beforeEach(() => {
  delete process.env.HERMES_HOME
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.HERMES_HOME
  else process.env.HERMES_HOME = originalHome
})

describe('Hermes desktop child environment', () => {
  it('pins production skill scripts to the same Hermes home as the UI', () => {
    const env = buildChildEnv({ sessionToken: 'session', override: { enabled: false } })
    const expected = process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA || '', 'hermes')
      : path.join(os.homedir(), '.hermes')

    expect(env.HERMES_HOME).toBe(expected)
    expect(env.HERMES_DASHBOARD_SESSION_TOKEN).toBe('session')
  })

  it('keeps the isolated QA home authoritative', () => {
    const isolated = path.resolve('C:/tmp/hermes-business-qa-home')
    const env = buildChildEnv({
      sessionToken: 'qa-session',
      override: { enabled: true, hermesHome: isolated }
    })

    expect(env.HERMES_HOME).toBe(isolated)
  })
})
