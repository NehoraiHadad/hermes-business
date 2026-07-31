import { describe, expect, it, vi } from 'vitest'
import {
  captureRollbackAnchor,
  manualSupportMessage,
  rollbackAfterFailedUpdate
} from './hermes-rollback.cjs'

const CMD = '/home/hermes-agent/venv/bin/hermes'
const ANCHOR = 'a1b2c3d4e5f6'

describe('captureRollbackAnchor', () => {
  it('captures the git HEAD for a git install', () => {
    const result = captureRollbackAnchor(CMD, {
      isGit: () => true,
      capture: () => ANCHOR
    })
    expect(result).toEqual({ gitInstall: true, anchor: ANCHOR })
  })

  it('reports no anchor for a non-git install (never calls capture)', () => {
    const capture = vi.fn()
    const result = captureRollbackAnchor(CMD, { isGit: () => false, capture })
    expect(result).toEqual({ gitInstall: false, anchor: null })
    expect(capture).not.toHaveBeenCalled()
  })
})

describe('rollbackAfterFailedUpdate', () => {
  it('resets a git checkout to the captured anchor and reports restored', () => {
    const reset = vi.fn().mockReturnValue({ ok: true, commit: ANCHOR })
    const log = vi.fn()
    const outcome = rollbackAfterFailedUpdate(
      { command: CMD, anchor: ANCHOR, backupPath: '/b/pre.zip' },
      { isGit: () => true, reset, log }
    )
    expect(outcome).toMatchObject({ restored: true, method: 'git', commit: ANCHOR })
    expect(reset).toHaveBeenCalledWith(CMD, ANCHOR)
  })

  it('fails closed (no reset) for a non-git install, surfacing the backup path', () => {
    const reset = vi.fn()
    const outcome = rollbackAfterFailedUpdate(
      { command: CMD, anchor: null, backupPath: '/b/pre.zip' },
      { isGit: () => false, reset }
    )
    expect(outcome.restored).toBe(false)
    expect(outcome.method).toBe('non-git')
    expect(outcome.message).toContain('/b/pre.zip')
    expect(reset).not.toHaveBeenCalled()
  })

  it('fails closed when a git install has no captured anchor (never guesses a target)', () => {
    const reset = vi.fn()
    const outcome = rollbackAfterFailedUpdate(
      { command: CMD, anchor: null, backupPath: '/b/pre.zip' },
      { isGit: () => true, reset, log: vi.fn() }
    )
    expect(outcome.restored).toBe(false)
    expect(reset).not.toHaveBeenCalled()
    expect(outcome.message).toContain('/b/pre.zip')
  })

  it('fails closed when the git reset itself fails', () => {
    const reset = vi.fn().mockReturnValue({ ok: false, reason: 'reset-failed', detail: 'lock held' })
    const outcome = rollbackAfterFailedUpdate(
      { command: CMD, anchor: ANCHOR, backupPath: '/b/pre.zip' },
      { isGit: () => true, reset, log: vi.fn() }
    )
    expect(outcome.restored).toBe(false)
    expect(outcome.message).toContain('/b/pre.zip')
  })
})

describe('manualSupportMessage', () => {
  it('names the verified backup when present', () => {
    expect(manualSupportMessage('/b/pre.zip')).toContain('/b/pre.zip')
  })

  it('is honest when no verified backup exists', () => {
    expect(manualSupportMessage(null)).toContain('לא נמצא גיבוי מאומת')
  })
})
