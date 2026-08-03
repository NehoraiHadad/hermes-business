import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  DISPOSABLE_ENV,
  QA_SENTINEL,
  assertSafeInstalledE2E,
  evaluateInstalledE2ESafety
} from './e2e-safety.mjs'

// Task 4.3 (docs/improvement-plan.md): the gate must PROVE isolation. A bare
// sentinel — the shape a stale ambient shell variable takes — is no longer
// enough; the complete QA quadruple has to hold, and the named temp home has to
// actually exist under the OS TEMP root.

const created: string[] = []
function tempHome(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hermes-qa-home-safety-'))
  created.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

function armed(overrides: Record<string, string> = {}) {
  return {
    HERMES_BUSINESS_QA_RUNTIME: QA_SENTINEL,
    HERMES_BUSINESS_QA_HERMES_HOME: tempHome(),
    HERMES_BUSINESS_QA_HOST: '127.0.0.1',
    HERMES_BUSINESS_QA_PORT: '47100',
    ...overrides
  }
}

describe('installed E2E safety gate', () => {
  it('blocks an ordinary workstation environment', () => {
    expect(() => assertSafeInstalledE2E({})).toThrow(/does not PROVE isolation/)
  })

  it('passes only on the COMPLETE QA quadruple', () => {
    const verdict = assertSafeInstalledE2E(armed())
    expect(verdict.mode).toBe('qa-isolated')
    expect(verdict.port).toBe(47100)
    expect(verdict.host).toBe('127.0.0.1')
    expect(path.isAbsolute(String(verdict.home))).toBe(true)
  })

  it('rejects a bare/stale sentinel with no home, host or port (the old pass condition)', () => {
    expect(() => assertSafeInstalledE2E({ HERMES_BUSINESS_QA_RUNTIME: QA_SENTINEL })).toThrow(
      /does not PROVE isolation/
    )
    const verdict = evaluateInstalledE2ESafety({ HERMES_BUSINESS_QA_RUNTIME: QA_SENTINEL })
    expect(verdict.ok).toBe(false)
    expect(verdict.reasons.length).toBe(3)
  })

  it('rejects a sentinel whose temp home no longer exists (stale ambient env)', () => {
    const gone = path.join(os.tmpdir(), 'hermes-qa-home-deleted-by-a-previous-run')
    rmSync(gone, { recursive: true, force: true })
    const verdict = evaluateInstalledE2ESafety(armed({ HERMES_BUSINESS_QA_HERMES_HOME: gone }))
    expect(verdict.ok).toBe(false)
    expect(verdict.reasons.join('\n')).toMatch(/must be an existing directory/)
  })

  it.each([
    ['a relative home', { HERMES_BUSINESS_QA_HERMES_HOME: 'relative/home' }, /absolute path/],
    ['a home outside TEMP', { HERMES_BUSINESS_QA_HERMES_HOME: os.homedir() }, /strictly under the OS TEMP root/],
    ['a non-loopback host', { HERMES_BUSINESS_QA_HOST: '0.0.0.0' }, /must be 127\.0\.0\.1/],
    ['a missing host', { HERMES_BUSINESS_QA_HOST: '' }, /must be set explicitly/],
    ['the live gateway port', { HERMES_BUSINESS_QA_PORT: '9119' }, /safe range/],
    ['a port below the safe range', { HERMES_BUSINESS_QA_PORT: '40999' }, /safe range/],
    ['a port above the safe range', { HERMES_BUSINESS_QA_PORT: '60001' }, /safe range/],
    ['a non-numeric port', { HERMES_BUSINESS_QA_PORT: 'abc' }, /must be an integer/]
  ])('rejects %s', (_label, override, pattern) => {
    const verdict = evaluateInstalledE2ESafety(armed(override as Record<string, string>))
    expect(verdict.ok).toBe(false)
    expect(verdict.reasons.join('\n')).toMatch(pattern as RegExp)
  })

  it('rejects a home that is a file rather than a directory', () => {
    const file = path.join(tempHome(), 'not-a-dir')
    writeFileSync(file, 'x', 'utf8')
    const verdict = evaluateInstalledE2ESafety(armed({ HERMES_BUSINESS_QA_HERMES_HOME: file }))
    expect(verdict.ok).toBe(false)
    expect(verdict.reasons.join('\n')).toMatch(/must be a directory/)
  })

  it('rejects a symlinked home leaf when the platform allows creating one', () => {
    const base = tempHome()
    const real = path.join(base, 'real')
    const link = path.join(base, 'link')
    mkdirSync(real, { recursive: true })
    try {
      symlinkSync(real, link, 'junction')
    } catch {
      return // unprivileged Windows without developer mode: nothing to assert
    }
    const verdict = evaluateInstalledE2ESafety(armed({ HERMES_BUSINESS_QA_HERMES_HOME: link }))
    expect(verdict.ok).toBe(false)
    expect(verdict.reasons.join('\n')).toMatch(/symlink|reparse/)
  })

  it('never lets the disposable-host hatch rescue a half-armed QA override', () => {
    const verdict = evaluateInstalledE2ESafety({
      HERMES_BUSINESS_QA_RUNTIME: QA_SENTINEL,
      [DISPOSABLE_ENV]: '1'
    })
    expect(verdict.ok).toBe(false)
  })

  it('rejects a sentinel set to the wrong value', () => {
    const verdict = evaluateInstalledE2ESafety({ HERMES_BUSINESS_QA_RUNTIME: 'yes-please' })
    expect(verdict.ok).toBe(false)
    expect(verdict.reasons.join('\n')).toMatch(/is not 'isolated-temp-home'/)
  })

  it('keeps the disposable-host hatch but warns loudly on every use', () => {
    const warn = vi.fn()
    const verdict = assertSafeInstalledE2E({ [DISPOSABLE_ENV]: '1' }, { warn })
    expect(verdict.mode).toBe('disposable-host')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/NO proof of isolation/)
  })
})
