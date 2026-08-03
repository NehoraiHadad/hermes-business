import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  evidencePath,
  getProviderEvidence,
  recordProviderEvidence,
  sanitizeEvidence,
  clearProviderEvidence
} from './provider-evidence.cjs'

let tmp: string
let prevHome: string | undefined

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-prov-ev-'))
  prevHome = process.env.HERMES_BUSINESS_HOME
  process.env.HERMES_BUSINESS_HOME = tmp
})
afterEach(() => {
  if (prevHome === undefined) delete process.env.HERMES_BUSINESS_HOME
  else process.env.HERMES_BUSINESS_HOME = prevHome
  fs.rmSync(tmp, { recursive: true, force: true })
})

const good = {
  provider: 'anthropic',
  model: 'anthropic/claude-opus-4-8',
  validatedAt: '2026-08-01T12:00:00.000Z',
  ok: true,
  reachable: true,
  method: 'validate' as const
}

describe('provider-evidence — durable, non-secret, sanitized, fail-closed', () => {
  it('persists under the Hermes-owned profile and round-trips', () => {
    expect(evidencePath()).toBe(path.join(tmp, 'business-state', 'provider-validation.json'))
    const saved = recordProviderEvidence(good)
    expect(saved).toEqual(good)
    expect(getProviderEvidence()).toEqual(good)
  })

  it('sanitizes to ONLY the allow-listed fields — a stray secret-bearing field is dropped', () => {
    const dirty = { ...good, apiKey: 'sk-secret', value: 'sk-secret', extra: 'nope' }
    const clean = sanitizeEvidence(dirty)
    expect(clean).toEqual(good)
    recordProviderEvidence(dirty)
    const onDisk = fs.readFileSync(evidencePath(), 'utf8')
    expect(onDisk).not.toContain('sk-secret')
    expect(onDisk).not.toContain('apiKey')
  })

  it('refuses malformed records (missing provider / bad timestamp)', () => {
    expect(sanitizeEvidence(null)).toBeNull()
    expect(sanitizeEvidence({ model: 'x' })).toBeNull()
    expect(sanitizeEvidence({ provider: 'a', validatedAt: 'not-a-date' })).toBeNull()
    expect(recordProviderEvidence({ provider: 'a' })).toBeNull()
  })

  it('coerces ok/reachable to strict booleans and defaults an unknown method', () => {
    const clean = sanitizeEvidence({ provider: 'a', validatedAt: good.validatedAt, ok: 'yes', reachable: 1, method: 'x' })
    expect(clean).toMatchObject({ ok: false, reachable: false, method: 'validate', model: null })
  })

  it('reads null when the file is absent or corrupt (fail closed, never a stale pass)', () => {
    expect(getProviderEvidence()).toBeNull()
    fs.mkdirSync(path.dirname(evidencePath()), { recursive: true })
    fs.writeFileSync(evidencePath(), '{ not json')
    expect(getProviderEvidence()).toBeNull()
  })

  it('clearProviderEvidence removes the record', () => {
    recordProviderEvidence(good)
    clearProviderEvidence()
    expect(getProviderEvidence()).toBeNull()
  })
})
