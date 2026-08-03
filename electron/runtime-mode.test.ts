import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEV_BINARY_ENV,
  DEV_HOME_ENV,
  DEV_PORT_ENV,
  DEV_SENTINEL_ENV,
  DEV_SENTINEL_VALUE,
  PROD_HOME_ENV,
  __resetRuntimeModeCache,
  defaultLiveHome,
  getRuntimeMode,
  resolveHermesBinary,
  resolveRuntimeMode
} from './runtime-mode.cjs'
import {
  HOME_ENV as QA_HOME_ENV,
  PORT_ENV as QA_PORT_ENV,
  SENTINEL_ENV as QA_SENTINEL_ENV,
  SENTINEL_VALUE as QA_SENTINEL_VALUE
} from './qa-runtime.cjs'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  __resetRuntimeModeCache()
})

function baseEnv(): NodeJS.ProcessEnv {
  return {
    LOCALAPPDATA: process.env.LOCALAPPDATA || path.join(os.tmpdir(), 'local-app-data'),
    TEMP: os.tmpdir(),
    PATH: `${path.join(os.tmpdir(), 'hermes-business-e2e', 'stale', 'bin')};C:\Windows`
  }
}

describe('runtime mode contract', () => {
  it('production ignores ambient HERMES_HOME and PATH contamination', () => {
    const env = {
      ...baseEnv(),
      HERMES_HOME: path.join(os.tmpdir(), 'hermes-business-e2e', 'stale', 'home')
    }
    const mode = resolveRuntimeMode(env)
    expect(mode.mode).toBe('live')
    expect(mode.hermesHome).toBe(defaultLiveHome(env))
    expect(mode.hermesBinary).toBeNull()
    expect(mode.electronUserData).toBeNull()
  })

  it('production rejects a product-owned override into an E2E temp tree', () => {
    const env = {
      ...baseEnv(),
      [PROD_HOME_ENV]: path.join(os.tmpdir(), 'hermes-business-e2e', 'bad', 'home')
    }
    expect(() => resolveRuntimeMode(env)).toThrow(/refuses a temporary Hermes E2E home/)
  })

  it('treats an explicit missing product binary as authoritative', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-missing-runtime-'))
    roots.push(root)
    const env = { ...baseEnv(), [DEV_BINARY_ENV]: path.join(root, 'missing-hermes.exe') }
    const mode = resolveRuntimeMode(env)
    expect(resolveHermesBinary(mode, env)).toBeNull()
  })

  it('development separates home, binary, userData, and port from production', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-dev-mode-'))
    roots.push(root)
    const env = {
      ...baseEnv(),
      [DEV_SENTINEL_ENV]: DEV_SENTINEL_VALUE,
      [DEV_HOME_ENV]: path.join(root, 'hermes-home'),
      [DEV_BINARY_ENV]: path.join(root, 'install', 'hermes.exe'),
      [DEV_PORT_ENV]: '19123'
    }
    const mode = resolveRuntimeMode(env)
    expect(mode.mode).toBe('development')
    expect(mode.hermesHome).toBe(path.join(root, 'hermes-home'))
    expect(mode.hermesBinary).toBe(path.join(root, 'install', 'hermes.exe'))
    expect(mode.preferredPort).toBe(19123)
    expect(mode.electronUserData).not.toBeNull()
    expect(mode.hermesHome).not.toBe(defaultLiveHome(env))
  })

  it('QA keeps the strict empty-temp-home contract', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-qa-home-'))
    roots.push(home)
    const mode = resolveRuntimeMode({
      ...baseEnv(),
      [QA_SENTINEL_ENV]: QA_SENTINEL_VALUE,
      [QA_HOME_ENV]: home,
      [QA_PORT_ENV]: '47123'
    })
    expect(mode.mode).toBe('qa-isolated')
    expect(mode.hermesHome).toBe(fs.realpathSync.native(home))
    expect(mode.electronUserData).toBe(path.join(fs.realpathSync.native(home), 'electron-user-data'))
    expect(mode.portRange).toBe(1)
  })
})

describe('getRuntimeMode — memoized QA verdict (startup self-break regression)', () => {
  function qaEnv(home: string): NodeJS.ProcessEnv {
    return {
      ...baseEnv(),
      [QA_SENTINEL_ENV]: QA_SENTINEL_VALUE,
      [QA_HOME_ENV]: home,
      [QA_PORT_ENV]: '47123'
    }
  }

  it('stays qa-isolated after the app populates the once-empty home', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-qa-home-'))
    roots.push(home)
    __resetRuntimeModeCache()

    const first = getRuntimeMode(qaEnv(home))
    expect(first.mode).toBe('qa-isolated')

    // Reproduce exactly what main.cjs does right after the first resolution:
    // create electron-user-data (and any file) inside the validated home.
    fs.mkdirSync(first.electronUserData, { recursive: true })
    fs.writeFileSync(path.join(first.hermesHome, 'config.yaml'), 'x')

    // Any later lookup (paths.hermesHome during installDesktopPlugin, runtime
    // launch, ...) must still succeed with the SAME verdict — the emptiness
    // check ran once, before the home was populated.
    const again = getRuntimeMode(qaEnv(home))
    expect(again.mode).toBe('qa-isolated')
    expect(again.hermesHome).toBe(first.hermesHome)
    expect(again.preferredPort).toBe(first.preferredPort)
  })

  it('keeps a requested-but-invalid override fail-closed on every call', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-qa-home-'))
    roots.push(home)
    fs.writeFileSync(path.join(home, 'stale.txt'), 'x')
    __resetRuntimeModeCache()

    const env = qaEnv(home)
    expect(() => getRuntimeMode(env)).toThrow(/EMPTY/)

    // Even after the home is emptied, the cached rejection stands: a QA run
    // that was refused must never silently start resolving mid-process.
    fs.rmSync(path.join(home, 'stale.txt'))
    expect(() => getRuntimeMode(env)).toThrow(/EMPTY/)
  })

  it('the pure resolver still re-validates every call (test-facing contract)', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-qa-home-'))
    roots.push(home)
    expect(resolveRuntimeMode(qaEnv(home)).mode).toBe('qa-isolated')
    fs.writeFileSync(path.join(home, 'config.yaml'), 'x')
    expect(() => resolveRuntimeMode(qaEnv(home))).toThrow(/EMPTY/)
  })
})
