import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  beginUpdate,
  updatePhase,
  recordFailure,
  readJournal,
  detectIncompleteUpdate,
  validateJournalRecord,
  clearJournal
} from './hermes-update-journal.cjs'

// Every test drives an isolated temp file — never the real business-state dir, so
// no user/live profile state is mutated.
let dir: string
let file: string
let history: string
let clock: number
const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString()

// Realistic captured rollback anchor: a full 40-hex git sha (what
// `git rev-parse HEAD` yields), which is what recovery must validate before it
// will ever `git reset` to it.
const ANCHOR = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-journal-'))
  file = path.join(dir, 'update-journal.json')
  history = path.join(dir, 'update-journal-history.json')
  clock = 0
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('update journal — atomic lifecycle', () => {
  it('begins with the pre-mutation metadata and phase "preflight"', () => {
    const rec = beginUpdate(
      { method: 'git', anchor: ANCHOR, currentVersion: '0.19.1', targetVersion: '0.19.2' },
      { file, now }
    )
    expect(rec).toMatchObject({
      journalVersion: 1,
      phase: 'preflight',
      method: 'git',
      anchor: ANCHOR,
      currentVersion: '0.19.1',
      targetVersion: '0.19.2'
    })
    expect(readJournal({ file })).toMatchObject({ phase: 'preflight' })
  })

  it('never records a secret — only the backup PATH is stored, no contents', () => {
    beginUpdate({ method: 'git', anchor: ANCHOR, backupPath: '/b/pre.zip' }, { file, now })
    const raw = fs.readFileSync(file, 'utf8')
    expect(raw).toContain('/b/pre.zip')
    expect(raw).not.toMatch(/token|secret|password/i)
  })

  it('advances phases and merges a patch (backupPath) atomically', () => {
    beginUpdate({ method: 'git', anchor: ANCHOR }, { file, now })
    updatePhase('mutating', { backupPath: '/b/pre.zip' }, { file, now })
    expect(readJournal({ file })).toMatchObject({ phase: 'mutating', backupPath: '/b/pre.zip' })
  })

  it('appends failures without clearing the journal (preserves the reason)', () => {
    beginUpdate({ method: 'git', anchor: ANCHOR }, { file, now })
    updatePhase('mutating', {}, { file, now })
    recordFailure(new Error('update --yes exploded'), { file, now })
    const rec = readJournal({ file })
    expect(rec.failures).toHaveLength(1)
    expect(rec.failures[0]).toMatchObject({ phase: 'mutating' })
    expect(rec.failures[0].error).toContain('update --yes exploded')
  })
})

describe('validateJournalRecord — trust gate before any rollback', () => {
  const valid = { journalVersion: 1, phase: 'mutating', method: 'git', anchor: ANCHOR, backupPath: '/b/pre.zip' }

  it('accepts a well-formed git journal', () => {
    expect(validateJournalRecord(valid)).toEqual({ valid: true })
  })

  it('rejects an unknown journalVersion', () => {
    expect(validateJournalRecord({ ...valid, journalVersion: 2 }).valid).toBe(false)
  })

  it('rejects an unknown phase', () => {
    expect(validateJournalRecord({ ...valid, phase: 'teleport' }).valid).toBe(false)
  })

  it('rejects an unrecoverable/unknown install method', () => {
    expect(validateJournalRecord({ ...valid, method: 'managed' }).valid).toBe(false)
    expect(validateJournalRecord({ ...valid, method: null }).valid).toBe(false)
  })

  it('rejects a missing or non-git-sha anchor (never trust an arbitrary reset target)', () => {
    expect(validateJournalRecord({ ...valid, anchor: null }).valid).toBe(false)
    expect(validateJournalRecord({ ...valid, anchor: 'HEAD~1; rm -rf /' }).valid).toBe(false)
    expect(validateJournalRecord({ ...valid, anchor: 'zzz' }).valid).toBe(false)
  })

  it('rejects a non-string backupPath', () => {
    expect(validateJournalRecord({ ...valid, backupPath: { evil: true } }).valid).toBe(false)
  })

  it('rejects a non-object', () => {
    expect(validateJournalRecord(null).valid).toBe(false)
    expect(validateJournalRecord([valid]).valid).toBe(false)
  })
})

describe('detectIncompleteUpdate — power-loss/restart recovery trigger', () => {
  it('returns null when there is no journal', () => {
    expect(detectIncompleteUpdate({ file })).toBeNull()
  })

  it('returns the record intact when a VALID update was interrupted mid-phase', () => {
    beginUpdate({ method: 'git', anchor: ANCHOR }, { file, now })
    updatePhase('mutating', {}, { file, now })
    expect(detectIncompleteUpdate({ file })).toMatchObject({ phase: 'mutating', anchor: ANCHOR, method: 'git' })
  })

  it('ignores a corrupt/half-written (non-JSON) journal rather than crashing', () => {
    fs.writeFileSync(file, '{ this is not json')
    expect(detectIncompleteUpdate({ file })).toBeNull()
  })

  it('strips the anchor and marks a MALFORMED journal so it can never drive git reset', () => {
    // Parseable JSON but an unknown version + a shell-injection-shaped anchor.
    fs.writeFileSync(
      file,
      JSON.stringify({ journalVersion: 99, phase: 'mutating', method: 'git', anchor: 'HEAD; do-evil', backupPath: '/b/pre.zip' })
    )
    const rec = detectIncompleteUpdate({ file })
    expect(rec).toMatchObject({ malformed: true, anchor: null, backupPath: '/b/pre.zip' })
    expect(rec.invalidReason).toMatch(/journalVersion/)
  })

  it('drops a non-string backupPath when sanitizing a malformed journal', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({ journalVersion: 1, phase: 'mutating', method: 'unknown', anchor: ANCHOR, backupPath: { x: 1 } })
    )
    const rec = detectIncompleteUpdate({ file })
    expect(rec).toMatchObject({ malformed: true, anchor: null, backupPath: null })
  })
})

describe('clearJournal — verifiable removal, best-effort history', () => {
  it('archives the record into history and removes the active journal', () => {
    beginUpdate({ method: 'git', anchor: ANCHOR }, { file, now })
    recordFailure(new Error('boom'), { file, now })
    const cleared = clearJournal({ outcome: 'rolled-back' }, { file, history, now, log: () => {} })
    expect(cleared).toMatchObject({ anchor: ANCHOR })
    expect(fs.existsSync(file)).toBe(false)
    const archive = JSON.parse(fs.readFileSync(history, 'utf8'))
    expect(archive.entries).toHaveLength(1)
    expect(archive.entries[0]).toMatchObject({ outcome: 'rolled-back' })
    expect(archive.entries[0].failures[0].error).toContain('boom')
  })

  it('bounds the history to the most recent entries', () => {
    for (let i = 0; i < 25; i++) {
      beginUpdate({ method: 'git', anchor: ANCHOR }, { file, now })
      clearJournal({ outcome: 'completed' }, { file, history, now, log: () => {} })
    }
    const archive = JSON.parse(fs.readFileSync(history, 'utf8'))
    expect(archive.entries.length).toBeLessThanOrEqual(20)
  })

  it('is a no-op-safe when there is nothing to clear', () => {
    expect(() => clearJournal({ outcome: 'completed' }, { file, history, now, log: () => {} })).not.toThrow()
    expect(fs.existsSync(file)).toBe(false)
  })

  it('THROWS when the active journal cannot be verifiably removed (injected no-op rm)', () => {
    beginUpdate({ method: 'git', anchor: ANCHOR }, { file, now })
    // rm silently does nothing (e.g. a mock, or a filesystem that ignores the
    // delete): the file survives, so a "clean" clear must NOT be reported.
    const rm = vi.fn() // no-op — leaves the file in place
    const log = vi.fn()
    expect(() =>
      clearJournal({ outcome: 'completed' }, { file, history, now, log, rm })
    ).toThrow(/still present after clear/)
    expect(fs.existsSync(file)).toBe(true)
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/could not confirm removal/))
  })

  it('THROWS when removal raises access-denied', () => {
    beginUpdate({ method: 'git', anchor: ANCHOR }, { file, now })
    const rm = vi.fn(() => {
      throw new Error('EACCES: permission denied')
    })
    const exists = vi.fn().mockReturnValue(true)
    expect(() =>
      clearJournal({ outcome: 'completed' }, { file, history, now, log: () => {}, rm, exists })
    ).toThrow(/Failed to remove active update journal/)
  })

  it('still removes the active journal when the best-effort history archive fails', () => {
    beginUpdate({ method: 'git', anchor: ANCHOR }, { file, now })
    // Point history at a path whose parent is a FILE, so safeWrite cannot create
    // it — the archive fails but removal must still proceed and be verified.
    const blocker = path.join(dir, 'not-a-dir')
    fs.writeFileSync(blocker, 'x')
    const badHistory = path.join(blocker, 'history.json')
    const log = vi.fn()
    expect(() =>
      clearJournal({ outcome: 'completed' }, { file, history: badHistory, now, log })
    ).not.toThrow()
    expect(fs.existsSync(file)).toBe(false)
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/history archive failed \(non-fatal\)/))
  })
})
