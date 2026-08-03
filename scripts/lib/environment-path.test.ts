import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { cleanHermesTestPath, cleanProcessEnv } from './environment-path.mjs'

describe('environment contamination guards', () => {
  it('removes only stale Hermes E2E PATH entries', () => {
    const entries = ['C:\\Windows', 'C:\\Temp\\hermes-business-e2e\\x\\bin', 'C:\\Tools\\node']
    const result = cleanHermesTestPath(entries.join(path.delimiter))
    expect(result.removed).toEqual([entries[1]])
    expect(result.kept).toEqual([entries[0], entries[2]])
  })

  it('strips ambient live-routing and QA variables from a dev launch', () => {
    const env = cleanProcessEnv({
      PATH: ['C:\\Temp\\hermes-qa-home-x\\bin', 'C:\\Windows'].join(path.delimiter),
      HERMES_HOME: 'C:\\wrong',
      HERMES_BUSINESS_QA_RUNTIME: 'isolated-temp-home',
      SAFE: 'yes'
    })
    expect(env.HERMES_HOME).toBeUndefined()
    expect(env.HERMES_BUSINESS_QA_RUNTIME).toBeUndefined()
    expect(env.PATH).toBe('C:\\Windows')
    expect(env.SAFE).toBe('yes')
  })
})
