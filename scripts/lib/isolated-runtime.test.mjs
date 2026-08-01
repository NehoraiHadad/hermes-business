import { describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import os from 'node:os'
import {
  createTempHermesHome,
  evaluateIsolationPreconditions,
  isolatedLaunchEnv,
  QA_SENTINEL_ENV,
  QA_SENTINEL_VALUE,
  QA_HOME_ENV,
  QA_PORT_ENV
} from './isolated-runtime.mjs'

describe('createTempHermesHome', () => {
  it('creates a fresh canonical dir under the TEMP root', () => {
    const home = createTempHermesHome()
    try {
      expect(home.toLowerCase()).toContain('hermes-qa-home-')
      expect(home.toLowerCase().startsWith(os.tmpdir().toLowerCase())).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('evaluateIsolationPreconditions — fail-fast before any approval', () => {
  const good = {
    runtimeMode: 'qa-isolated',
    wsPort: 47123,
    isolatedPort: 47123,
    diagnosticsHome: 'C:\\Users\\x\\AppData\\Local\\Temp\\hermes-qa-home-abc',
    tempHome: 'C:\\Users\\x\\AppData\\Local\\Temp\\hermes-qa-home-abc',
    isolatedSessionCount: 0
  }

  it('passes only when all four invariants hold', () => {
    const r = evaluateIsolationPreconditions(good)
    expect(r.ok).toBe(true)
    expect(r.failed).toEqual([])
  })

  it('REPRODUCES the incident: live-gateway collision (live mode, default port, 72 sessions, live home) aborts', () => {
    // The exact failed-run signature: an Electron single-instance/userData
    // collision forwarded the launch to the live gateway.
    const r = evaluateIsolationPreconditions({
      runtimeMode: 'live',
      wsPort: 9119,
      isolatedPort: 47123,
      diagnosticsHome: 'C:\\Users\\x\\AppData\\Local\\hermes',
      tempHome: 'C:\\Users\\x\\AppData\\Local\\Temp\\hermes-qa-home-abc',
      isolatedSessionCount: 72
    })
    expect(r.ok).toBe(false)
    expect(r.failed).toContain('runtime_mode_qa_isolated')
    expect(r.failed).toContain('ws_on_isolated_port')
    expect(r.failed).toContain('diagnostics_home_is_temp')
    expect(r.failed).toContain('isolated_session_count_zero')
  })

  it('aborts on a non-isolated WS port even if mode looks right', () => {
    expect(evaluateIsolationPreconditions({ ...good, wsPort: 9120 }).ok).toBe(false)
  })

  it('aborts when the diagnostics home is not the temp home', () => {
    const r = evaluateIsolationPreconditions({ ...good, diagnosticsHome: 'C:\\Users\\x\\AppData\\Local\\hermes' })
    expect(r.ok).toBe(false)
    expect(r.failed).toEqual(['diagnostics_home_is_temp'])
  })

  it('aborts on a non-zero baseline session count (only 0 is safe to approve against)', () => {
    expect(evaluateIsolationPreconditions({ ...good, isolatedSessionCount: 1 }).ok).toBe(false)
    expect(evaluateIsolationPreconditions({ ...good, isolatedSessionCount: 'error: ws error' }).ok).toBe(false)
    expect(evaluateIsolationPreconditions({ ...good, isolatedSessionCount: null }).ok).toBe(false)
  })

  it('treats trailing-separator / case differences in the home as equal (Windows)', () => {
    const r = evaluateIsolationPreconditions({
      ...good,
      diagnosticsHome: good.tempHome.toUpperCase() + '\\'
    })
    expect(r.checks.diagnostics_home_is_temp).toBe(true)
  })
})

describe('isolatedLaunchEnv', () => {
  it('arms the exact QA contract env', () => {
    const env = isolatedLaunchEnv({ home: 'C:\\tmp\\iso', port: 47123 })
    expect(env[QA_SENTINEL_ENV]).toBe(QA_SENTINEL_VALUE)
    expect(env[QA_HOME_ENV]).toBe('C:\\tmp\\iso')
    expect(env[QA_PORT_ENV]).toBe('47123')
  })

  it('rejects a port outside the safe range', () => {
    expect(() => isolatedLaunchEnv({ home: 'C:\\tmp\\iso', port: 8080 })).toThrow(/safe range/)
  })
})
