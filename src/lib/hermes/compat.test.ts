import { describe, expect, it } from 'vitest'
import { HERMES_COMPAT_RANGE as SDK_RANGE } from '../../../scripts/plugin-sdk-contract.mjs'
import {
  HERMES_COMPAT_RANGE,
  describeUnsupported,
  isVersionSupported,
  parseVersion
} from './compat'

describe('hermes compat contract', () => {
  it('stays in lockstep with the build-time SDK range', () => {
    expect(HERMES_COMPAT_RANGE).toBe(SDK_RANGE)
    expect(HERMES_COMPAT_RANGE).toBe('>=0.19.0 <0.20.0')
  })

  it('parses a real --version banner', () => {
    expect(parseVersion('Hermes Agent v0.19.1 (2026.6.19)')).toEqual({ major: 0, minor: 19, patch: 1 })
    expect(parseVersion('0.19')).toEqual({ major: 0, minor: 19, patch: 0 })
    expect(parseVersion('not a version')).toBeNull()
  })

  it('accepts only the supported window', () => {
    expect(isVersionSupported('v0.19.0')).toBe(true)
    expect(isVersionSupported('v0.19.7')).toBe(true)
    expect(isVersionSupported('v0.18.9')).toBe(false)
    expect(isVersionSupported('v0.20.0')).toBe(false)
    expect(isVersionSupported('v0.21.3')).toBe(false)
    expect(isVersionSupported(null)).toBe(false)
  })

  it('describes an unsupported runtime truthfully without promising an update', () => {
    const message = describeUnsupported('v0.20.0')
    expect(message).toContain('0.20.0')
    expect(message).toContain('>=0.19.0 <0.20.0')
    expect(message).toContain('לא בוצע עדכון אוטומטי')
  })
})
