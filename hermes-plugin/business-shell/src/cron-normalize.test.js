import { describe, expect, it } from 'vitest'
import { extractJobs, resolveBackendPayload } from './cron-normalize.js'

describe('extractJobs', () => {
  it('returns a bare array unchanged', () => {
    expect(extractJobs([{ id: 'a' }])).toEqual([{ id: 'a' }])
  })
  it('unwraps a { jobs: [...] } envelope', () => {
    expect(extractJobs({ jobs: [{ id: 'a' }] })).toEqual([{ id: 'a' }])
  })
  it('returns null for malformed shapes so the caller degrades', () => {
    expect(extractJobs(null)).toBeNull()
    expect(extractJobs(undefined)).toBeNull()
    expect(extractJobs('nope')).toBeNull()
    expect(extractJobs(42)).toBeNull()
    expect(extractJobs({})).toBeNull()
    expect(extractJobs({ jobs: 'oops' })).toBeNull()
    expect(extractJobs({ jobs: { 0: 'x' } })).toBeNull()
  })
})

describe('resolveBackendPayload', () => {
  it('trusts a well-formed non-degraded body (including an empty list)', () => {
    expect(resolveBackendPayload({ jobs: [{ id: 'a' }], paused_listing_supported: true })).toEqual({
      jobs: [{ id: 'a' }],
      pausedListingSupported: true
    })
    // A genuinely empty supported backend still counts as supported.
    expect(resolveBackendPayload({ jobs: [], paused_listing_supported: true })).toEqual({
      jobs: [],
      pausedListingSupported: true
    })
  })

  it('degrades on an explicit degraded / unsupported body', () => {
    expect(resolveBackendPayload({ jobs: [], degraded: true })).toBeNull()
    expect(resolveBackendPayload({ jobs: [{ id: 'a' }], paused_listing_supported: false })).toBeNull()
  })

  it('degrades on null / non-object payloads', () => {
    expect(resolveBackendPayload(null)).toBeNull()
    expect(resolveBackendPayload(undefined)).toBeNull()
    expect(resolveBackendPayload('')).toBeNull()
    expect(resolveBackendPayload(0)).toBeNull()
  })

  it('degrades on a missing/garbage jobs shape even without an explicit flag', () => {
    expect(resolveBackendPayload({})).toBeNull()
    expect(resolveBackendPayload({ paused_listing_supported: true })).toBeNull()
    expect(resolveBackendPayload({ jobs: null })).toBeNull()
    expect(resolveBackendPayload({ jobs: 'x' })).toBeNull()
  })
})
