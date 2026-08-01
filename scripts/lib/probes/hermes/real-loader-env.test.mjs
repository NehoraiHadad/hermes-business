import { describe, expect, it } from 'vitest'
import {
  assertChildEnv,
  buildChildEnv,
  findLeakKeys,
  isAllowedPassthrough,
  isSensitiveName,
  sanitizeChildEnv
} from './real-loader-env.mjs'

const sandbox = {
  hermesHome: 'C:\\Temp\\iso\\hermes-home',
  userData: 'C:\\Temp\\iso\\user-data',
  cwd: 'C:\\Temp\\iso\\cwd',
  userProfile: 'C:\\Temp\\iso\\profile',
  appData: 'C:\\Temp\\iso\\profile\\AppData\\Roaming',
  localAppData: 'C:\\Temp\\iso\\profile\\AppData\\Local',
  tmp: 'C:\\Temp\\iso\\tmp',
  xdgConfig: 'C:\\Temp\\iso\\profile\\.config',
  xdgCache: 'C:\\Temp\\iso\\profile\\.cache',
  xdgData: 'C:\\Temp\\iso\\profile\\.local\\share'
}

// The adversarial negative set from the review — each MUST be dropped (or re-homed
// away from its source value) and must never reach the child. Mixed case included.
const HOSTILE_ENV = {
  Browser_Cdp_Url: 'http://127.0.0.1:9222',
  PythonPath: 'C:\\evil\\site-packages',
  Ssh_Auth_Sock: '\\\\.\\pipe\\ssh',
  GH_CONFIG_DIR: 'C:\\Users\\real\\.config\\gh',
  ANTHROPIC_BASE_URL: 'https://evil.example',
  openai_api_key: 'sk-live-xxx',
  Telegram_Bot_Token: '123:abc',
  My_JWT: 'ey.header.sig',
  HTTPS_PROXY: 'http://proxy.corp:8080',
  Some_Provider_Channel: 'telegram',
  DATABASE_URL: 'postgres://u:p@host/db',
  SESSION_TOKEN: 'deadbeef',
  MY_PASSWORD: 'hunter2'
}

describe('real-loader-env allowlist classification', () => {
  it('allows only known system passthrough vars', () => {
    for (const name of ['PATH', 'SystemRoot', 'windir', 'ProgramFiles', 'NUMBER_OF_PROCESSORS', 'COMSPEC']) {
      expect(isAllowedPassthrough(name)).toBe(true)
    }
    for (const name of Object.keys(HOSTILE_ENV)) {
      expect(isAllowedPassthrough(name)).toBe(false)
    }
    // Home/cache/config vars are re-homed, not passthrough.
    for (const name of ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'HOME', 'XDG_CONFIG_HOME']) {
      expect(isAllowedPassthrough(name)).toBe(false)
    }
  })

  it('flags every hostile name as sensitive (defense-in-depth), keeps system vars clean', () => {
    for (const name of Object.keys(HOSTILE_ENV)) {
      expect(isSensitiveName(name)).toBe(true)
    }
    for (const name of ['PATH', 'SystemRoot', 'TEMP', 'PROGRAMFILES', 'SESSIONNAME', 'USERNAME']) {
      expect(isSensitiveName(name)).toBe(false)
    }
  })
})

describe('real-loader-env sanitizeChildEnv', () => {
  it('keeps ONLY allow-listed vars and drops everything else (incl. all HERMES_*)', () => {
    const clean = sanitizeChildEnv({
      PATH: 'x',
      SystemRoot: 'C:\\Windows',
      HERMES_HOME: 'C:\\live\\hermes',
      HERMES_DESKTOP_HERMES_ROOT: 'C:\\dev\\checkout',
      USERPROFILE: 'C:\\Users\\real',
      ...HOSTILE_ENV
    })
    expect(clean.PATH).toBe('x')
    expect(clean.SystemRoot).toBe('C:\\Windows')
    expect(clean.HERMES_HOME).toBeUndefined()
    expect(clean.HERMES_DESKTOP_HERMES_ROOT).toBeUndefined()
    expect(clean.USERPROFILE).toBeUndefined()
    for (const name of Object.keys(HOSTILE_ENV)) expect(clean[name]).toBeUndefined()
  })

  it('skips null-valued vars', () => {
    const clean = sanitizeChildEnv({ PATH: 'x', EMPTY: undefined })
    expect('EMPTY' in clean).toBe(false)
  })
})

describe('real-loader-env buildChildEnv', () => {
  const base = { PATH: 'x', SystemRoot: 'C:\\Windows', ...HOSTILE_ENV, USERPROFILE: 'C:\\Users\\real' }

  it('re-homes owned vars and lets no hostile source value survive', () => {
    const env = buildChildEnv({ base, sandbox, cliBin: 'C:\\hermes\\hermes.exe' })
    expect(env.HERMES_HOME).toBe(sandbox.hermesHome)
    expect(env.HERMES_DESKTOP_USER_DATA_DIR).toBe(sandbox.userData)
    expect(env.HERMES_DESKTOP_HERMES).toBe('C:\\hermes\\hermes.exe')
    expect(env.HERMES_DESKTOP_CWD).toBe(sandbox.cwd)
    expect(env.HOME).toBe(sandbox.userProfile)
    expect(env.USERPROFILE).toBe(sandbox.userProfile)
    expect(env.HOMEDRIVE).toBe('C:')
    expect(env.HOMEPATH).toBe('\\Temp\\iso\\profile')
    expect(env.APPDATA).toBe(sandbox.appData)
    expect(env.LOCALAPPDATA).toBe(sandbox.localAppData)
    expect(env.TEMP).toBe(sandbox.tmp)
    expect(env.TMP).toBe(sandbox.tmp)
    // XDG_CONFIG_HOME is re-homed into the sandbox, never the source value.
    expect(env.XDG_CONFIG_HOME).toBe(sandbox.xdgConfig)
    // No hostile var — by name or by leaked value.
    for (const name of Object.keys(HOSTILE_ENV)) expect(name in env).toBe(false)
    expect('HERMES_DESKTOP_HERMES_ROOT' in env).toBe(false)
    expect(findLeakKeys(env)).toEqual([])
  })

  it('requires a CLI binary', () => {
    expect(() => buildChildEnv({ base, sandbox, cliBin: '' })).toThrow(/cliBin/)
  })

  it('assertChildEnv rejects a re-introduced forbidden, sensitive, or unknown var', () => {
    const env = buildChildEnv({ base, sandbox, cliBin: 'C:\\hermes\\hermes.exe' })
    expect(() => assertChildEnv({ ...env, HERMES_DESKTOP_HERMES_ROOT: 'C:\\x' })).toThrow(/forbidden/)
    expect(() => assertChildEnv({ ...env, ANTHROPIC_API_KEY: 'sk' })).toThrow(/non-allowlisted|sensitive/)
    // An unknown, non-sensitive-shaped var still fails the allowlist post-condition.
    expect(() => assertChildEnv({ ...env, SOME_RANDOM_TOOL_DIR: 'C:\\x' })).toThrow(/non-allowlisted|sensitive/)
  })
})
