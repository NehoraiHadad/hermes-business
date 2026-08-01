import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createTempHermesHome,
  evaluateIsolationPreconditions,
  isolatedLaunchEnv,
  QA_SENTINEL_ENV,
  QA_SENTINEL_VALUE,
  QA_HOME_ENV,
  QA_PORT_ENV
} from './isolated-runtime.mjs'
import { hermesHomeMarker, markerDelta } from './isolated-marker.mjs'

function seededHome(files = {}) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'marker-'))
  created.push(home)
  writeFileSync(path.join(home, 'config.yaml'), files.config ?? 'x: 1\n')
  return home
}

const created = []
afterEach(() => {
  while (created.length) {
    try {
      rmSync(created.pop(), { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

describe('createTempHermesHome', () => {
  it('creates a fresh canonical dir under the TEMP root', () => {
    const home = createTempHermesHome()
    created.push(home)
    expect(home.toLowerCase()).toContain('hermes-qa-home-')
    expect(home.toLowerCase().startsWith(os.tmpdir().toLowerCase())).toBe(true)
  })
})

describe('hermesHomeMarker', () => {
  it('changes when config.yaml changes (approvals.mode toggle proxy)', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'marker-'))
    created.push(home)
    writeFileSync(path.join(home, 'config.yaml'), 'approvals:\n  mode: auto\n')
    const before = hermesHomeMarker(home)
    writeFileSync(path.join(home, 'config.yaml'), 'approvals:\n  mode: manual\n')
    const after = hermesHomeMarker(home)
    expect(after.digest).not.toBe(before.digest)
    expect(before.configPresent).toBe(true)
  })

  it('changes when a session/cron/skill entry appears', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'marker-'))
    created.push(home)
    writeFileSync(path.join(home, 'config.yaml'), 'x: 1\n')
    mkdirSync(path.join(home, 'sessions'))
    const before = hermesHomeMarker(home)
    writeFileSync(path.join(home, 'sessions', 'new-session.json'), '{}')
    const after = hermesHomeMarker(home)
    expect(after.digest).not.toBe(before.digest)
    expect(after.inventory.sessions).toBe(1)
  })

  it('is stable across a re-read with no changes', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'marker-'))
    created.push(home)
    writeFileSync(path.join(home, 'config.yaml'), 'x: 1\n')
    expect(hermesHomeMarker(home).digest).toBe(hermesHomeMarker(home).digest)
  })
})

describe('markerDelta — attribute live changes precisely', () => {
  it('treats a same-name timestamp/size bump (live gateway churn) as NOT a mutation', () => {
    const home = seededHome()
    mkdirSync(path.join(home, 'cron'))
    writeFileSync(path.join(home, 'cron', 'job-a.json'), '{"next":1}')
    const before = hermesHomeMarker(home)
    // The live gateway rewrites the SAME cron file with new state (size changes).
    writeFileSync(path.join(home, 'cron', 'job-a.json'), '{"next":222222222}')
    const after = hermesHomeMarker(home)
    const delta = markerDelta(before, after)
    expect(delta.digest_equal).toBe(false) // overall digest sees the size change
    expect(delta.config_changed).toBe(false)
    expect(delta.profile_defining_unchanged).toBe(true) // but no name added/removed
  })

  it('flags a NEW named cron/skill entry (the old suite\'s additive mutation)', () => {
    const home = seededHome()
    mkdirSync(path.join(home, 'skills'))
    const before = hermesHomeMarker(home)
    writeFileSync(path.join(home, 'skills', 'poc-weekly-lead-summary.md'), '# skill')
    const after = hermesHomeMarker(home)
    const delta = markerDelta(before, after)
    expect(delta.added_removed.skills.added).toBe(1)
    expect(delta.profile_defining_unchanged).toBe(false)
  })

  it('flags a config.yaml (approvals.mode) toggle', () => {
    const home = seededHome({ config: 'approvals:\n  mode: auto\n' })
    const before = hermesHomeMarker(home)
    writeFileSync(path.join(home, 'config.yaml'), 'approvals:\n  mode: manual\n')
    const after = hermesHomeMarker(home)
    expect(markerDelta(before, after).profile_defining_unchanged).toBe(false)
  })

  it('ignores pure session churn by the concurrent live gateway', () => {
    const home = seededHome()
    mkdirSync(path.join(home, 'sessions'))
    const before = hermesHomeMarker(home)
    writeFileSync(path.join(home, 'sessions', 'live-gateway-session.json'), '{}')
    const after = hermesHomeMarker(home)
    const delta = markerDelta(before, after)
    expect(delta.added_removed.sessions.added).toBe(1)
    expect(delta.profile_defining_unchanged).toBe(true) // sessions excluded
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
