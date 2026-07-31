import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalizeSettings, readSettings, writeRootEnv, writeSettings } from './partner-settings.cjs'

let home: string
let previousHome: string | undefined

beforeEach(() => {
  previousHome = process.env.HERMES_HOME
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-partner-settings-'))
  process.env.HERMES_HOME = home
})

afterEach(() => {
  if (previousHome === undefined) delete process.env.HERMES_HOME
  else process.env.HERMES_HOME = previousHome
  fs.rmSync(home, { recursive: true, force: true })
})

describe('normalizeSettings', () => {
  it('falls back to safe defaults for unknown values', () => {
    expect(normalizeSettings({ mode: 'weird', sandbox: 'nope' })).toMatchObject({
      mode: 'normal',
      sandbox: 'guard',
      network: false,
      checkins: false,
      roots: []
    })
  })

  it('dedupes roots by path with last-write-wins access and defaults to ro', () => {
    const settings = normalizeSettings({
      roots: [
        { path: 'C:/a' },
        { path: 'C:/a', access: 'rw' },
        { path: 'C:/b', access: 'weird' }
      ]
    })
    expect(settings.roots).toEqual([
      { path: 'C:/a', access: 'rw' },
      { path: 'C:/b', access: 'ro' }
    ])
  })
})

describe('persistence', () => {
  it('round-trips through disk', () => {
    writeSettings({ mode: 'partner', sandbox: 'docker', network: true, roots: [{ path: 'C:/x', access: 'rw' }] })
    expect(readSettings()).toMatchObject({
      mode: 'partner',
      sandbox: 'docker',
      network: true,
      roots: [{ path: 'C:/x', access: 'rw' }]
    })
  })

  it('returns defaults when no file exists', () => {
    expect(readSettings()).toMatchObject({ mode: 'normal', sandbox: 'guard' })
  })
})

describe('writeRootEnv', () => {
  it('is null unless partner mode is in the local guard tier', () => {
    expect(writeRootEnv(normalizeSettings({ mode: 'normal', sandbox: 'guard' }))).toBeNull()
    expect(writeRootEnv(normalizeSettings({ mode: 'partner', sandbox: 'off' }))).toBeNull()
    expect(writeRootEnv(normalizeSettings({ mode: 'partner', sandbox: 'docker' }))).toBeNull()
  })

  it('joins only writable roots in the guard tier', () => {
    const env = writeRootEnv(
      normalizeSettings({
        mode: 'partner',
        sandbox: 'guard',
        roots: [
          { path: 'C:/read', access: 'ro' },
          { path: 'C:/write1', access: 'rw' },
          { path: 'C:/write2', access: 'rw' }
        ]
      })
    )
    expect(env).toBe(['C:/write1', 'C:/write2'].join(path.delimiter))
  })

  it('is null in guard tier with no writable roots', () => {
    expect(
      writeRootEnv(normalizeSettings({ mode: 'partner', sandbox: 'guard', roots: [{ path: 'C:/ro', access: 'ro' }] }))
    ).toBeNull()
  })
})
