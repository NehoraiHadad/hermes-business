import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalizeSettings, readSettings, settingsPath, writeRootEnv, writeSettings } from './partner-settings.cjs'

const DENY_ALL = (home: string) => path.join(home, 'business', 'partner-settings.json', '.deny-all')

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

describe('checkinCadence', () => {
  it('defaults to weekly and clamps unknown values', () => {
    expect(normalizeSettings({}).checkinCadence).toBe('weekly')
    expect(normalizeSettings({ checkinCadence: 'hourly' }).checkinCadence).toBe('weekly')
    expect(normalizeSettings({ checkinCadence: 'daily' }).checkinCadence).toBe('daily')
  })
})

describe('writeRootEnv', () => {
  // Real directories: writeRootEnv now validates roots and fails closed on
  // invalid ones (a Hebrew+spaces path is a normal, valid directory).
  function realDir(...parts: string[]) {
    const dir = path.join(home, ...parts)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  it('is null unless partner mode is in the local guard tier', () => {
    expect(writeRootEnv(normalizeSettings({ mode: 'normal', sandbox: 'guard' }))).toBeNull()
    expect(writeRootEnv(normalizeSettings({ mode: 'partner', sandbox: 'off' }))).toBeNull()
    expect(writeRootEnv(normalizeSettings({ mode: 'partner', sandbox: 'docker' }))).toBeNull()
  })

  it('joins only valid writable roots (incl. Hebrew + spaces) in the guard tier', () => {
    const ro = realDir('read only')
    const w1 = realDir('כתיבה 1')
    const w2 = realDir('write two')
    const env = writeRootEnv(
      normalizeSettings({
        mode: 'partner',
        sandbox: 'guard',
        roots: [
          { path: ro, access: 'ro' },
          { path: w1, access: 'rw' },
          { path: w2, access: 'rw' }
        ]
      })
    )
    expect(env).toBe([fs.realpathSync.native(w1), fs.realpathSync.native(w2)].join(path.delimiter))
  })

  it('fails closed to a deny-all sentinel in guard tier with NO writable roots', () => {
    // Zero valid writable roots (read-only only) must NOT leave writes
    // unrestricted (null) — Hermes treats a blank env as allow-all.
    const ro = realDir('ro-only')
    expect(
      writeRootEnv(normalizeSettings({ mode: 'partner', sandbox: 'guard', roots: [{ path: ro, access: 'ro' }] }))
    ).toBe(DENY_ALL(home))
  })

  it('fails closed to a deny-all sentinel with no roots at all', () => {
    expect(writeRootEnv(normalizeSettings({ mode: 'partner', sandbox: 'guard', roots: [] }))).toBe(DENY_ALL(home))
  })

  it('fails closed to a deny-all sentinel when a designated writable root is invalid', () => {
    const env = writeRootEnv(
      normalizeSettings({
        mode: 'partner',
        sandbox: 'guard',
        roots: [{ path: path.join(home, 'does-not-exist'), access: 'rw' }]
      })
    )
    // Not null (that would leave writes unrestricted) and not a real target dir.
    expect(env).toBe(DENY_ALL(home))
  })

  it('derives the deny-all boundary AFTER the settings file is persisted, and its parent is that file', () => {
    // Ordering invariant: applyPartnerMode persists settings before deriving the
    // env, so the guarding regular file is on disk when the boundary goes live.
    const persisted = writeSettings({ mode: 'partner', sandbox: 'guard', roots: [] })
    const env = writeRootEnv(persisted)
    expect(env).toBe(DENY_ALL(home))
    // The sentinel's parent is exactly the persisted settings file, a regular file.
    expect(path.dirname(env!)).toBe(settingsPath())
    expect(fs.statSync(settingsPath()).isFile()).toBe(true)
    // With the guarding file present, Hermes' file-tool primitives cannot create it.
    expect(() => fs.writeFileSync(env!, 'x')).toThrow()
    expect(() => fs.mkdirSync(env!, { recursive: true })).toThrow()
  })
})
