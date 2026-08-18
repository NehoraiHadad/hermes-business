import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  JOURNAL_VERSION,
  PHASES,
  beginCompanionUpdate,
  updateCompanionPhase,
  recordCompanionFailure,
  readCompanionJournal,
  validateCompanionJournalRecord,
  detectIncompleteCompanionUpdate,
  clearCompanionJournal
} from './companion-update-journal.cjs'

// Every test drives an isolated temp file — never the real business-state dir, so
// no user/live profile state is mutated.
let dir: string
let file: string
let history: string
let installer: string
let clock: number
const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString()

// A realistic SHA-256 of the downloaded installer: exactly 64 LOWERCASE hex.
const DIGEST = 'a'.repeat(63) + '9'

function seed(overrides: Record<string, unknown> = {}) {
  return beginCompanionUpdate(
    {
      currentVersion: '0.4.0-alpha.7',
      targetVersion: '0.4.0-alpha.8',
      installerPath: installer,
      installerSha256: DIGEST,
      ...overrides
    },
    { file, now }
  )
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-journal-'))
  file = path.join(dir, 'companion-update-journal.json')
  history = path.join(dir, 'companion-update-journal-history.json')
  // Absolute on every platform because it is derived from a real temp dir.
  installer = path.join(dir, 'Tachles Setup 0.4.0-alpha.8.exe')
  clock = 0
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('companion update journal — atomic lifecycle', () => {
  it('begins at phase "downloading" with the full pre-download metadata', () => {
    const rec = seed()
    expect(rec).toMatchObject({
      journalVersion: JOURNAL_VERSION,
      phase: 'downloading',
      currentVersion: '0.4.0-alpha.7',
      targetVersion: '0.4.0-alpha.8',
      installerPath: installer,
      installerSha256: DIGEST
    })
    expect(readCompanionJournal({ file })).toMatchObject({ phase: 'downloading' })
  })

  it('walks the exact companion state machine downloading → verifying → ready → applying', () => {
    seed()
    for (const phase of PHASES.slice(1)) {
      updateCompanionPhase(phase, {}, { file, now })
      expect(readCompanionJournal({ file })).toMatchObject({ phase })
    }
  })

  it('records only non-secret operational metadata (path, never bytes or tokens)', () => {
    seed()
    const raw = fs.readFileSync(file, 'utf8')
    expect(raw).toContain(DIGEST)
    expect(raw).not.toMatch(/token|secret|password/i)
  })

  it('merges a patch on a phase advance and never recreates a vanished journal', () => {
    seed()
    updateCompanionPhase('applying', { appliedAt: 'stamp' }, { file, now })
    expect(readCompanionJournal({ file })).toMatchObject({ phase: 'applying', appliedAt: 'stamp' })
    fs.rmSync(file)
    expect(updateCompanionPhase('ready', {}, { file, now })).toBeNull()
    expect(fs.existsSync(file)).toBe(false)
  })

  it('appends failures without clearing the record (preserves the reason)', () => {
    seed()
    updateCompanionPhase('verifying', {}, { file, now })
    recordCompanionFailure(new Error('digest mismatch'), { file, now })
    const rec = readCompanionJournal({ file })
    expect(rec.failures).toHaveLength(1)
    expect(rec.failures[0]).toMatchObject({ phase: 'verifying' })
    expect(rec.failures[0].error).toContain('digest mismatch')
  })

  it('fsyncs the record when the caller demands durability (apply path)', () => {
    const sync = vi.fn()
    seed()
    updateCompanionPhase('applying', {}, { file, now, durable: true, sync })
    expect(sync).toHaveBeenCalledWith(file)
    // ...and NOT on an ordinary write.
    sync.mockClear()
    updateCompanionPhase('ready', {}, { file, now, sync })
    expect(sync).not.toHaveBeenCalled()
  })

  it('really fsyncs through the default implementation (no injected stub)', () => {
    seed()
    expect(() => updateCompanionPhase('applying', {}, { file, now, durable: true })).not.toThrow()
    expect(readCompanionJournal({ file })).toMatchObject({ phase: 'applying' })
  })
})

describe('validateCompanionJournalRecord — trust gate before a launch or a delete', () => {
  const valid = () => ({
    journalVersion: 1,
    phase: 'applying',
    currentVersion: '0.4.0-alpha.7',
    targetVersion: '0.4.0-alpha.8',
    installerPath: path.join(os.tmpdir(), 'setup.exe'),
    installerSha256: DIGEST
  })

  it('accepts a well-formed record', () => {
    expect(validateCompanionJournalRecord(valid())).toEqual({ valid: true })
  })

  it('rejects a non-object', () => {
    expect(validateCompanionJournalRecord(null).code).toBe('not-an-object')
    expect(validateCompanionJournalRecord([valid()]).code).toBe('not-an-object')
  })

  it('rejects an unknown journalVersion', () => {
    const v = validateCompanionJournalRecord({ ...valid(), journalVersion: 2 })
    expect(v).toMatchObject({ valid: false, code: 'unknown-journal-version' })
  })

  it('rejects an unknown phase (including the agent journalphases, which are NOT ours)', () => {
    expect(validateCompanionJournalRecord({ ...valid(), phase: 'teleport' }).code).toBe('unknown-phase')
    // 'mutating' belongs to the Hermes-agent git journal; it means nothing here.
    expect(validateCompanionJournalRecord({ ...valid(), phase: 'mutating' }).code).toBe('unknown-phase')
  })

  it('rejects a targetVersion that is not strict SemVer', () => {
    for (const bad of ['0.4', 'latest', '0.4.0+build', '', null, 4]) {
      expect(validateCompanionJournalRecord({ ...valid(), targetVersion: bad })).toMatchObject({
        valid: false,
        code: 'target-version-malformed'
      })
    }
  })

  it('rejects a currentVersion that is not strict SemVer', () => {
    expect(validateCompanionJournalRecord({ ...valid(), currentVersion: 'v0.4' })).toMatchObject({
      valid: false,
      code: 'current-version-malformed'
    })
  })

  it('rejects an installerSha256 that is not 64 LOWERCASE hex', () => {
    for (const bad of [DIGEST.toUpperCase(), DIGEST.slice(0, 63), `${DIGEST}0`, 'zz', null, {}]) {
      expect(validateCompanionJournalRecord({ ...valid(), installerSha256: bad })).toMatchObject({
        valid: false,
        code: 'installer-digest-malformed'
      })
    }
  })

  it('rejects an installerPath that is not absolute (never resolve against a random cwd)', () => {
    for (const bad of ['setup.exe', path.join('..', 'evil.exe'), '', null, 7]) {
      expect(validateCompanionJournalRecord({ ...valid(), installerPath: bad })).toMatchObject({
        valid: false,
        code: 'installer-path-not-absolute'
      })
    }
  })
})

describe('detectIncompleteCompanionUpdate — launch-time trigger', () => {
  it('returns null when there is no journal', () => {
    expect(detectIncompleteCompanionUpdate({ file })).toBeNull()
  })

  it('returns a VALID interrupted record intact', () => {
    seed()
    updateCompanionPhase('applying', {}, { file, now })
    expect(detectIncompleteCompanionUpdate({ file })).toMatchObject({
      phase: 'applying',
      installerPath: installer,
      installerSha256: DIGEST,
      targetVersion: '0.4.0-alpha.8'
    })
  })

  it('ignores a corrupt/half-written (non-JSON) journal rather than crashing', () => {
    fs.writeFileSync(file, '{ this is not json')
    expect(detectIncompleteCompanionUpdate({ file })).toBeNull()
  })

  it('STRIPS the untrusted installerPath of a malformed record (never launch/delete a corrupt path)', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        journalVersion: 99,
        phase: 'applying',
        currentVersion: '0.4.0-alpha.7',
        targetVersion: '0.4.0-alpha.8',
        installerPath: 'C:\\Windows\\System32\\calc.exe',
        installerSha256: DIGEST
      })
    )
    const rec = detectIncompleteCompanionUpdate({ file })
    expect(rec).toMatchObject({ malformed: true, installerPath: null, invalidCode: 'unknown-journal-version' })
    expect(rec.invalidReason).toMatch(/journalVersion/)
    // The digest was well-formed, so it survives as context for the message.
    expect(rec.installerSha256).toBe(DIGEST)
  })

  it('also drops a malformed installerSha256 while stripping the path', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        journalVersion: 1,
        phase: 'applying',
        currentVersion: '0.4.0-alpha.7',
        targetVersion: 'not-a-version',
        installerPath: 'C:\\Windows\\System32\\calc.exe',
        installerSha256: 'AABB'
      })
    )
    expect(detectIncompleteCompanionUpdate({ file })).toMatchObject({
      malformed: true,
      installerPath: null,
      installerSha256: null,
      invalidCode: 'target-version-malformed'
    })
  })
})

describe('clearCompanionJournal — verifiable removal, best-effort history', () => {
  it('archives into history and removes the active journal', () => {
    seed()
    recordCompanionFailure(new Error('boom'), { file, now })
    const cleared = clearCompanionJournal({ outcome: 'apply-failed' }, { file, history, now, log: () => {} })
    expect(cleared).toMatchObject({ installerPath: installer })
    expect(fs.existsSync(file)).toBe(false)
    const archive = JSON.parse(fs.readFileSync(history, 'utf8'))
    expect(archive.entries).toHaveLength(1)
    expect(archive.entries[0]).toMatchObject({ outcome: 'apply-failed' })
    expect(archive.entries[0].failures[0].error).toContain('boom')
  })

  it('bounds the history at 20 entries', () => {
    for (let i = 0; i < 25; i++) {
      seed()
      clearCompanionJournal({ outcome: 'applied' }, { file, history, now, log: () => {} })
    }
    const archive = JSON.parse(fs.readFileSync(history, 'utf8'))
    expect(archive.entries.length).toBeLessThanOrEqual(20)
  })

  it('is no-op-safe when there is nothing to clear', () => {
    expect(() =>
      clearCompanionJournal({ outcome: 'applied' }, { file, history, now, log: () => {} })
    ).not.toThrow()
    expect(fs.existsSync(file)).toBe(false)
  })

  it('THROWS when the active journal cannot be verifiably removed (injected no-op rm)', () => {
    seed()
    const rm = vi.fn() // no-op — leaves the file in place
    const log = vi.fn()
    expect(() => clearCompanionJournal({ outcome: 'applied' }, { file, history, now, log, rm })).toThrow(
      /still present after clear/
    )
    expect(fs.existsSync(file)).toBe(true)
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/could not confirm removal/))
  })

  it('THROWS when removal raises access-denied', () => {
    seed()
    const rm = vi.fn(() => {
      throw new Error('EACCES: permission denied')
    })
    expect(() =>
      clearCompanionJournal({ outcome: 'applied' }, { file, history, now, log: () => {}, rm, exists: () => true })
    ).toThrow(/Failed to remove active companion update journal/)
  })

  it('still removes the active journal when the best-effort history archive fails', () => {
    seed()
    const blocker = path.join(dir, 'not-a-dir')
    fs.writeFileSync(blocker, 'x')
    const log = vi.fn()
    expect(() =>
      clearCompanionJournal({ outcome: 'applied' }, { file, history: path.join(blocker, 'h.json'), now, log })
    ).not.toThrow()
    expect(fs.existsSync(file)).toBe(false)
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/history archive failed \(non-fatal\)/))
  })
})
