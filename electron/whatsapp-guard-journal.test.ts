import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  JOURNAL_SCHEMA,
  clearGuardActivationJournal,
  isValidJournalRecord,
  journalPath,
  readGuardActivationJournal,
  writeGuardActivationJournal
} from './whatsapp-guard-journal.cjs'
import { guardStatusWithActivation } from './whatsapp-guard-status.cjs'

describe('whatsapp-guard-journal — record validation, atomic write, verifiable clear', () => {
  let tmp: string
  let prevHome: string | undefined
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-guard-journal-'))
    prevHome = process.env.HERMES_BUSINESS_HOME
    process.env.HERMES_BUSINESS_HOME = tmp
  })
  afterEach(() => {
    if (prevHome === undefined) delete process.env.HERMES_BUSINESS_HOME
    else process.env.HERMES_BUSINESS_HOME = prevHome
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  describe('isValidJournalRecord', () => {
    it('accepts a well-formed record', () => {
      expect(
        isValidJournalRecord({
          schema: JOURNAL_SCHEMA,
          status: 'active',
          updatedAt: new Date().toISOString(),
          changed: true,
          supersedeNonce: 'abc',
          expectedVersion: '0.2.0'
        })
      ).toBe(true)
    })

    it('accepts a minimal record (only the required fields)', () => {
      expect(isValidJournalRecord({ schema: JOURNAL_SCHEMA, status: 'failed', updatedAt: '2026-01-01T00:00:00.000Z' })).toBe(
        true
      )
    })

    it('rejects null/non-object input', () => {
      expect(isValidJournalRecord(null)).toBe(false)
      expect(isValidJournalRecord('active')).toBe(false)
      expect(isValidJournalRecord(42)).toBe(false)
    })

    it('rejects a legacy/mismatched schema version (fails closed, does not crash)', () => {
      expect(isValidJournalRecord({ schema: 999, status: 'active', updatedAt: 'x' })).toBe(false)
    })

    it('rejects an unknown status', () => {
      expect(isValidJournalRecord({ schema: JOURNAL_SCHEMA, status: 'bogus', updatedAt: 'x' })).toBe(false)
    })

    it('rejects a missing/non-string updatedAt', () => {
      expect(isValidJournalRecord({ schema: JOURNAL_SCHEMA, status: 'active' })).toBe(false)
      expect(isValidJournalRecord({ schema: JOURNAL_SCHEMA, status: 'active', updatedAt: 123 })).toBe(false)
    })

    it('rejects wrongly-typed optional fields', () => {
      expect(
        isValidJournalRecord({ schema: JOURNAL_SCHEMA, status: 'active', updatedAt: 'x', changed: 'yes' })
      ).toBe(false)
      expect(
        isValidJournalRecord({ schema: JOURNAL_SCHEMA, status: 'active', updatedAt: 'x', supersedeNonce: 5 })
      ).toBe(false)
      expect(
        isValidJournalRecord({ schema: JOURNAL_SCHEMA, status: 'active', updatedAt: 'x', reason: 5 })
      ).toBe(false)
    })
  })

  describe('read/write round-trip', () => {
    it('writes atomically (temp+rename) and reads back the same record', () => {
      const written = writeGuardActivationJournal({ status: 'verifying', changed: true, supersedeNonce: 'n1' })
      expect(fs.existsSync(journalPath())).toBe(true)
      // no stray temp file left behind
      expect(fs.readdirSync(path.dirname(journalPath())).some(name => name.endsWith('.tmp'))).toBe(false)
      expect(readGuardActivationJournal()).toEqual(written)
    })

    it('a legacy/corrupted file on disk fails closed to null, not a crash', () => {
      fs.mkdirSync(path.dirname(journalPath()), { recursive: true })
      fs.writeFileSync(journalPath(), JSON.stringify({ status: 'restarting' })) // no schema field at all
      expect(readGuardActivationJournal()).toBeNull()
    })

    it('garbage (non-JSON) on disk fails closed to null', () => {
      fs.mkdirSync(path.dirname(journalPath()), { recursive: true })
      fs.writeFileSync(journalPath(), 'not json{{{')
      expect(readGuardActivationJournal()).toBeNull()
    })

    it('a null journal is treated as "no in-flight transaction" by guardStatusWithActivation (fails closed, not open)', () => {
      fs.mkdirSync(path.dirname(journalPath()), { recursive: true })
      fs.writeFileSync(journalPath(), JSON.stringify({ status: 'restarting' })) // invalid: no schema
      let sawSupersede: unknown = 'unset'
      const read = (forward: { supersedeNonce?: string }) => {
        sawSupersede = forward.supersedeNonce
        return null
      }
      expect(guardStatusWithActivation({ read } as any)).toBeNull()
      expect(sawSupersede).toBeUndefined()
    })
  })

  describe('clearGuardActivationJournal — verifiable', () => {
    it('removes the file and returns normally when removal is confirmed', () => {
      writeGuardActivationJournal({ status: 'active' })
      expect(() => clearGuardActivationJournal()).not.toThrow()
      expect(fs.existsSync(journalPath())).toBe(false)
    })

    it('is a no-op-safe on an already-absent file', () => {
      expect(fs.existsSync(journalPath())).toBe(false)
      expect(() => clearGuardActivationJournal()).not.toThrow()
    })

    it('throws when rm() itself throws', () => {
      writeGuardActivationJournal({ status: 'active' })
      expect(() =>
        clearGuardActivationJournal({
          rm: () => {
            throw new Error('EPERM')
          },
          log: () => {}
        })
      ).toThrow(/Failed to remove guard activation journal/)
    })

    it('throws when the file survives a "successful" removal (verified, not trusted blindly)', () => {
      writeGuardActivationJournal({ status: 'active' })
      expect(() =>
        clearGuardActivationJournal({
          rm: () => {
            /* pretend to remove but don't */
          },
          exists: () => true,
          log: () => {}
        })
      ).toThrow(/still present after clear/)
    })
  })
})
