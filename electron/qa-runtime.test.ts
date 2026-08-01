import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  resolveQaRuntimeOverride,
  childEnvForOverride,
  QaOverrideError,
  SENTINEL_ENV,
  SENTINEL_VALUE,
  HOME_ENV,
  HOST_ENV,
  PORT_ENV
} from './qa-runtime.cjs'

// Every case exercises the PURE resolver against a synthetic env so the
// process-wide memo is never touched. Real directories are used because the
// contract validates canonical realpaths on the actual filesystem.

const created: string[] = []
function freshTempHome(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'qa-home-'))
  created.push(dir)
  return dir
}
function baseEnv(home: string, extra: Record<string, string> = {}) {
  return {
    [SENTINEL_ENV]: SENTINEL_VALUE,
    [HOME_ENV]: home,
    [HOST_ENV]: '127.0.0.1',
    [PORT_ENV]: '45678',
    ...extra
  }
}

afterEach(() => {
  while (created.length) {
    try {
      rmSync(created.pop()!, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

describe('resolveQaRuntimeOverride — production path', () => {
  it('is disabled with no sentinel, ignoring any stray QA vars', () => {
    const home = freshTempHome()
    const result = resolveQaRuntimeOverride({ [HOME_ENV]: home, [PORT_ENV]: '45678' })
    expect(result).toEqual({ enabled: false })
  })

  it('is disabled when the sentinel value is wrong', () => {
    const home = freshTempHome()
    expect(resolveQaRuntimeOverride({ ...baseEnv(home), [SENTINEL_ENV]: '1' })).toEqual({
      enabled: false
    })
  })
})

describe('resolveQaRuntimeOverride — valid QA override', () => {
  it('accepts an empty temp home + loopback host + safe high port', () => {
    const home = freshTempHome()
    const result = resolveQaRuntimeOverride(baseEnv(home))
    expect(result.enabled).toBe(true)
    expect(result.host).toBe('127.0.0.1')
    expect(result.port).toBe(45678)
    // canonical realpath, still under temp
    expect(result.hermesHome.toLowerCase()).toContain('qa-home-')
  })

  it('defaults the host to loopback when unset', () => {
    const home = freshTempHome()
    const env = baseEnv(home)
    delete (env as Record<string, string>)[HOST_ENV]
    expect(resolveQaRuntimeOverride(env).host).toBe('127.0.0.1')
  })
})

describe('resolveQaRuntimeOverride — fail-closed rejections', () => {
  it('rejects a relative home', () => {
    expect(() => resolveQaRuntimeOverride(baseEnv('relative/path'))).toThrow(QaOverrideError)
  })

  it('rejects a non-existent home (not newly created)', () => {
    const home = path.join(os.tmpdir(), 'qa-missing-does-not-exist-xyz')
    expect(() => resolveQaRuntimeOverride(baseEnv(home))).toThrow(/newly-created/)
  })

  it('rejects a NON-empty home', () => {
    const home = freshTempHome()
    writeFileSync(path.join(home, 'config.yaml'), 'x')
    expect(() => resolveQaRuntimeOverride(baseEnv(home))).toThrow(/EMPTY/)
  })

  it('rejects a home outside the system TEMP root', () => {
    const outside = mkdtempSync(path.join(os.homedir(), 'qa-nottmp-'))
    created.push(outside)
    expect(() => resolveQaRuntimeOverride(baseEnv(outside))).toThrow(/TEMP root/)
  })

  it('rejects a home under the live/default HERMES_HOME', () => {
    const live = freshTempHome()
    const sub = path.join(live, 'nested')
    mkdirSync(sub)
    // `sub` is under temp (passes that gate) but also under the declared live home.
    expect(() => resolveQaRuntimeOverride(baseEnv(sub, { HERMES_HOME: live }))).toThrow(
      /live\/default/
    )
  })

  it('rejects a symlinked leaf (reparse escape) when the OS allows creating one', () => {
    const real = freshTempHome()
    const link = path.join(os.tmpdir(), `qa-link-${real.split(/[\\/]/).pop()}`)
    try {
      symlinkSync(real, link, 'dir')
    } catch {
      return // no symlink privilege on this host; covered by realpath containment
    }
    created.push(link)
    expect(() => resolveQaRuntimeOverride(baseEnv(link))).toThrow(/symlink|reparse/)
  })

  it('rejects the default gateway port', () => {
    const home = freshTempHome()
    expect(() => resolveQaRuntimeOverride(baseEnv(home, { [PORT_ENV]: '9119' }))).toThrow(
      /safe range/
    )
  })

  it('rejects a port below and above the safe range', () => {
    const home = freshTempHome()
    expect(() => resolveQaRuntimeOverride(baseEnv(home, { [PORT_ENV]: '8080' }))).toThrow()
    expect(() => resolveQaRuntimeOverride(baseEnv(home, { [PORT_ENV]: '65000' }))).toThrow()
  })

  it('rejects a non-numeric port', () => {
    const home = freshTempHome()
    expect(() => resolveQaRuntimeOverride(baseEnv(home, { [PORT_ENV]: 'abcd' }))).toThrow(
      /integer/
    )
  })

  it('rejects a non-loopback host', () => {
    const home = freshTempHome()
    expect(() => resolveQaRuntimeOverride(baseEnv(home, { [HOST_ENV]: '0.0.0.0' }))).toThrow()
    expect(() => resolveQaRuntimeOverride(baseEnv(home, { [HOST_ENV]: 'localhost' }))).toThrow()
  })
})

describe('childEnvForOverride', () => {
  it('points HERMES_HOME at the isolated home and hard-disables every channel', () => {
    const overlay = childEnvForOverride({ hermesHome: 'C:\\tmp\\iso', host: '127.0.0.1', port: 45678 })
    expect(overlay.HERMES_HOME).toBe('C:\\tmp\\iso')
    expect(overlay.WHATSAPP_ENABLED).toBe('0')
    expect(overlay.TELEGRAM_ENABLED).toBe('0')
    expect(overlay.EMAIL_ENABLED).toBe('0')
    expect(overlay.HERMES_TELEMETRY_DISABLED).toBe('1')
  })
})
