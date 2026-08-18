// Unit coverage for the user-level gateway login-item guard: snapshot before,
// verify + restore after, and the teardown verdict folding a mutation into a
// FAILED run even when the restore succeeded.
import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loginItemPath, snapshotLoginItem, verifyAndRestoreLoginItem } from './login-item-guard.mjs'
import { finalizeTeardown } from './teardown.mjs'

function tempItem(content) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'login-item-guard-'))
  const item = path.join(dir, 'Hermes_Gateway.vbs')
  if (content !== null) writeFileSync(item, content)
  return { dir, item }
}

describe('snapshotLoginItem', () => {
  it('captures exact bytes of an existing item', () => {
    const { dir, item } = tempItem('target = "C:\\live\\gateway-service\\Hermes_Gateway.vbs"\r\n')
    try {
      const snap = snapshotLoginItem({ itemPath: item })
      expect(snap).toEqual({
        applicable: true,
        path: item,
        exists: true,
        content: 'target = "C:\\live\\gateway-service\\Hermes_Gateway.vbs"\r\n'
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('records absence so a clean machine must stay clean', () => {
    const { dir, item } = tempItem(null)
    try {
      expect(snapshotLoginItem({ itemPath: item })).toEqual({ applicable: true, path: item, exists: false, content: null })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is honestly inapplicable without a resolvable path', () => {
    expect(snapshotLoginItem({ itemPath: null })).toEqual({ applicable: false, path: null, exists: false, content: null })
  })

  it('loginItemPath needs APPDATA', () => {
    if (process.platform === 'win32') {
      expect(loginItemPath({})).toBeNull()
      expect(loginItemPath({ APPDATA: 'C:\\Users\\x\\AppData\\Roaming' })).toMatch(/Hermes_Gateway\.vbs$/)
    } else {
      expect(loginItemPath({ APPDATA: '/x' })).toBeNull()
    }
  })
})

describe('verifyAndRestoreLoginItem', () => {
  it('unchanged item passes with no restore', () => {
    const { dir, item } = tempItem('same\n')
    try {
      const snap = snapshotLoginItem({ itemPath: item })
      expect(verifyAndRestoreLoginItem(snap)).toEqual({ applicable: true, unchanged: true, restored: null })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a MUTATED item is restored byte-exact and reported unchanged:false', () => {
    const { dir, item } = tempItem('target = "live"\n')
    try {
      const snap = snapshotLoginItem({ itemPath: item })
      writeFileSync(item, 'target = "C:\\Temp\\hermes-qa-home-xxxx\\gateway-service\\Hermes_Gateway.vbs"\n')
      const verdict = verifyAndRestoreLoginItem(snap)
      expect(verdict).toEqual({ applicable: true, unchanged: false, restored: true })
      expect(readFileSync(item, 'utf8')).toBe('target = "live"\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('an item CREATED on a previously-clean machine is deleted again', () => {
    const { dir, item } = tempItem(null)
    try {
      const snap = snapshotLoginItem({ itemPath: item })
      writeFileSync(item, 'target = "qa"\n')
      const verdict = verifyAndRestoreLoginItem(snap)
      expect(verdict).toEqual({ applicable: true, unchanged: false, restored: true })
      expect(existsSync(item)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a failed restore is reported, never masked', () => {
    const { dir, item } = tempItem('live\n')
    try {
      const snap = snapshotLoginItem({ itemPath: item })
      writeFileSync(item, 'qa\n')
      const verdict = verifyAndRestoreLoginItem(snap, {
        fs: {
          existsSync,
          readFileSync,
          writeFileSync: () => {
            throw new Error('locked')
          },
          unlinkSync: () => {
            throw new Error('locked')
          }
        }
      })
      expect(verdict).toEqual({ applicable: true, unchanged: false, restored: false, restore_error: 'locked' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('inapplicable snapshot disables the guard honestly', () => {
    expect(verifyAndRestoreLoginItem({ applicable: false })).toEqual({ applicable: false, unchanged: null, restored: null })
    expect(verifyAndRestoreLoginItem(null)).toEqual({ applicable: false, unchanged: null, restored: null })
  })
})

describe('finalizeTeardown login-item verdict', () => {
  // Everything except the login item passes; the injected verdict decides ok.
  async function runTeardown(loginVerdict) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'login-guard-teardown-'))
    const report = { ok: true, teardown: {} }
    try {
      await finalizeTeardown({
        report,
        tempHome: path.join(dir, 'gone'),
        isolatedPort: 47190,
        liveHome: dir,
        liveMarkerBefore: (await import('../isolated-marker.mjs')).hermesHomeMarker(dir),
        probePath: path.join(dir, 'absent-probe.txt'),
        forensicDir: path.join(dir, 'forensics'),
        runApproval: false,
        // Off-Windows containment is inapplicable; on Windows an absent temp
        // home yields removed:true with an ok snapshot ({ok:true,records:[]}).
        ownedProcs: { ok: true, records: [] },
        loginItemBefore: { applicable: true, path: 'x', exists: true, content: 'live' },
        verifyLoginItem: vi.fn().mockReturnValue(loginVerdict)
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    return report
  }

  it('a mutated-but-restored login item still FAILS the run', async () => {
    const report = await runTeardown({ applicable: true, unchanged: false, restored: true })
    expect(report.teardown.login_item_untouched).toBe(false)
    expect(report.teardown.login_item_restored).toBe(true)
    expect(report.ok).toBe(false)
  })

  it('an untouched login item leaves the verdict to the other gates', async () => {
    const report = await runTeardown({ applicable: true, unchanged: true, restored: null })
    expect(report.teardown.login_item_untouched).toBe(true)
    expect(report.ok).toBe(true)
  })
})
