import { describe, expect, it } from 'vitest'
import { CHANNELS, FULL_RIGOR_CHANNELS, SIGNING_TOLERANT_CHANNELS, assertKnownChannel, requiresFullRigor, isSigningTolerant } from './channel-policy.mjs'

describe('channel-policy groupings', () => {
  it('re-exports the single CHANNELS list (public, qa, pilot)', () => {
    expect(CHANNELS).toEqual(['public', 'qa', 'pilot'])
  })

  it('full-rigor: public and pilot; qa is the only tolerant one', () => {
    expect(requiresFullRigor('public')).toBe(true)
    expect(requiresFullRigor('pilot')).toBe(true)
    expect(requiresFullRigor('qa')).toBe(false)
    expect([...FULL_RIGOR_CHANNELS].sort()).toEqual(['pilot', 'public'])
  })

  it('signing-tolerant: qa and pilot; public is the only strict one', () => {
    expect(isSigningTolerant('qa')).toBe(true)
    expect(isSigningTolerant('pilot')).toBe(true)
    expect(isSigningTolerant('public')).toBe(false)
    expect([...SIGNING_TOLERANT_CHANNELS].sort()).toEqual(['pilot', 'qa'])
  })

  it('ADVERSARIAL: an unknown channel THROWS from every predicate — it must never fall through to the lenient side of a grouping', () => {
    for (const bogus of ['nightly', 'Public', '', undefined, null]) {
      expect(() => assertKnownChannel(bogus)).toThrow(/unknown release channel/)
      expect(() => requiresFullRigor(bogus)).toThrow(/unknown release channel/)
      expect(() => isSigningTolerant(bogus)).toThrow(/unknown release channel/)
    }
  })

  it('pilot is full-rigor AND signing-tolerant at the same time (the whole point of the channel)', () => {
    expect(requiresFullRigor('pilot') && isSigningTolerant('pilot')).toBe(true)
  })
})
