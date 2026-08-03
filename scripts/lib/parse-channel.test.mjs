import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CHANNELS, DEFAULT_CHANNEL, parseChannel } from './parse-channel.mjs'

const repoRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))

describe('parseChannel', () => {
  it('defaults to the public channel', () => {
    expect(parseChannel([])).toBe('public')
    expect(DEFAULT_CHANNEL).toBe('public')
    expect(CHANNELS).toEqual(['public', 'qa'])
  })

  it('reads an explicit channel from anywhere in argv', () => {
    expect(parseChannel(['--channel', 'qa'])).toBe('qa')
    expect(parseChannel(['--no-probe', '--channel', 'public'])).toBe('public')
    expect(parseChannel(['--channel', 'qa', '--no-probe'])).toBe('qa')
  })

  it('rejects a trailing --channel instead of silently yielding undefined', () => {
    expect(() => parseChannel(['--channel'])).toThrow(/requires a value/)
    expect(() => parseChannel(['--channel', '--no-probe'])).toThrow(/requires a value/)
  })

  it('rejects an unknown or mis-cased channel', () => {
    expect(() => parseChannel(['--channel', 'prod'])).toThrow(/unknown channel/)
    expect(() => parseChannel(['--channel', 'Public'])).toThrow(/unknown channel/)
    expect(() => parseChannel(['--channel', ''])).toThrow(/unknown channel/)
  })

  it('rejects conflicting repeats but tolerates a harmless duplicate', () => {
    expect(() => parseChannel(['--channel', 'qa', '--channel', 'public'])).toThrow(/conflicting/)
    expect(parseChannel(['--channel', 'qa', '--channel', 'qa'])).toBe('qa')
  })

  it('supports the --qa shorthand only when asked', () => {
    expect(parseChannel(['--qa'], { allowShorthand: true })).toBe('qa')
    expect(parseChannel(['--qa'])).toBe('public')
    expect(() => parseChannel(['--qa', '--channel', 'public'], { allowShorthand: true })).toThrow(/conflicting/)
  })

  it('honours an explicit default', () => {
    expect(parseChannel([], { defaultChannel: 'qa' })).toBe('qa')
    expect(() => parseChannel([], { defaultChannel: 'prod' })).toThrow(/invalid default channel/)
  })
})

describe('every channel-taking script uses the shared parser', () => {
  const scripts = [
    'scripts/verify-release-contract.mjs',
    'scripts/finalize-release.mjs',
    'scripts/sign-release.mjs',
    'scripts/finalize-payload.mjs',
    'scripts/e2e-exact-artifact.mjs',
    'scripts/package-win.mjs'
  ]

  it.each(scripts)('%s imports parseChannel and re-implements no ad-hoc variant', file => {
    const source = readFileSync(path.join(repoRoot, file), 'utf8')
    expect(source).toMatch(/from '\.\/lib\/parse-channel\.mjs'/)
    // The exact ad-hoc idioms this helper replaced must not come back.
    expect(source).not.toMatch(/indexOf\('--channel'\)/)
    expect(source).not.toMatch(/argv\[\+\+i\]/)
  })
})
