import { describe, expect, it } from 'vitest'
import { assertSafeInstalledE2E } from './e2e-safety.mjs'

describe('installed E2E safety gate', () => {
  it('blocks an ordinary workstation environment', () => {
    expect(() => assertSafeInstalledE2E({})).toThrow(/blocked on a normal workstation/)
  })

  it('allows the strict QA runtime and an explicit disposable host', () => {
    expect(() => assertSafeInstalledE2E({ HERMES_BUSINESS_QA_RUNTIME: 'isolated-temp-home' })).not.toThrow()
    expect(() => assertSafeInstalledE2E({ HERMES_BUSINESS_DISPOSABLE_WINDOWS: '1' })).not.toThrow()
  })
})
