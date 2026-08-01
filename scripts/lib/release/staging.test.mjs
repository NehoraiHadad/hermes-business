import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  assertNotSymlink, makeStaging, stageSidecar, fingerprintCandidate, candidateUnchanged, finalizeSidecars,
  recoverRelease, JOURNAL_NAME
} from './staging.mjs'

const tmp = []
afterEach(() => { while (tmp.length) rmSync(tmp.pop(), { recursive: true, force: true }) })
function work() {
  const d = mkdtempSync(path.join(os.tmpdir(), 'stg-'))
  tmp.push(d)
  return d
}

describe('atomic sidecar promotion (finding 11)', () => {
  it('promotes staged sidecars ONLY after the gate passes', () => {
    const target = work()
    const stg = makeStaging(target)
    const staged = [stageSidecar(stg, 'ACCEPTANCE.md', '# accepted'), stageSidecar(stg, 'checksums.json', '{}')]
    const r = finalizeSidecars({ stagingDir: stg, targetDir: target, staged, gatePassed: true })
    expect(r.promoted).toBe(true)
    expect(readFileSync(path.join(target, 'ACCEPTANCE.md'), 'utf8')).toBe('# accepted')
    expect(existsSync(stg)).toBe(false)
  })

  it('a FAILED gate leaves the PRIOR official sidecar untouched (adversarial)', () => {
    const target = work()
    writeFileSync(path.join(target, 'ACCEPTANCE.md'), 'OLD-official')
    const stg = makeStaging(target)
    const staged = [stageSidecar(stg, 'ACCEPTANCE.md', 'FRESH-should-not-appear')]
    const r = finalizeSidecars({ stagingDir: stg, targetDir: target, staged, gatePassed: false })
    expect(r.promoted).toBe(false)
    expect(readFileSync(path.join(target, 'ACCEPTANCE.md'), 'utf8')).toBe('OLD-official')
    expect(existsSync(stg)).toBe(false)
  })
})

describe('transactional promotion with backup/rollback (HIGH 8)', () => {
  it('rolls the WHOLE batch back if a rename fails mid-promotion (adversarial)', () => {
    const target = work()
    // Two existing official files that must survive a failed transaction unchanged.
    writeFileSync(path.join(target, 'checksums.json'), 'OLD-checksums')
    writeFileSync(path.join(target, 'release-report.json'), 'OLD-report')
    const stg = makeStaging(target)
    const staged = [
      stageSidecar(stg, 'checksums.json', 'NEW-checksums'),
      stageSidecar(stg, 'release-report.json', 'NEW-report')
    ]
    let n = 0
    const promote = (from, to) => { if (++n === 2) throw new Error('disk full on second rename'); require('node:fs').renameSync(from, to) }
    const r = finalizeSidecars({ stagingDir: stg, targetDir: target, staged, gatePassed: true, promote })
    expect(r.promoted).toBe(false)
    expect(r.reason).toMatch(/rolled back/)
    // BOTH originals restored — no half-updated official set.
    expect(readFileSync(path.join(target, 'checksums.json'), 'utf8')).toBe('OLD-checksums')
    expect(readFileSync(path.join(target, 'release-report.json'), 'utf8')).toBe('OLD-report')
    expect(existsSync(stg)).toBe(false)
  })

  it('release-report.json is promoted in the SAME transaction (no direct overwrite)', () => {
    const target = work()
    const stg = makeStaging(target)
    const staged = [
      stageSidecar(stg, 'checksums.json', '{"ok":true}'),
      stageSidecar(stg, 'release-report.json', '{"report":true}')
    ]
    const r = finalizeSidecars({ stagingDir: stg, targetDir: target, staged, gatePassed: true })
    expect(r.promoted).toBe(true)
    expect(r.files).toEqual(['checksums.json', 'release-report.json'])
    expect(readFileSync(path.join(target, 'release-report.json'), 'utf8')).toBe('{"report":true}')
  })
})

describe('TOCTOU candidate re-verification (finding 12)', () => {
  it('refuses promotion if a guarded candidate mutated mid-run', () => {
    const target = work()
    const cand = path.join(target, 'installer.exe')
    writeFileSync(cand, 'v1-bytes')
    const fp = fingerprintCandidate(cand)
    expect(candidateUnchanged(fp)).toBe(true)
    writeFileSync(cand, 'v2-TAMPERED') // mutate after fingerprint
    const stg = makeStaging(target)
    const staged = [stageSidecar(stg, 'checksums.json', '{}')]
    const r = finalizeSidecars({ stagingDir: stg, targetDir: target, staged, candidates: [fp], gatePassed: true })
    expect(r.promoted).toBe(false)
    expect(r.reason).toMatch(/mutated mid-run/)
    expect(existsSync(path.join(target, 'checksums.json'))).toBe(false)
  })
})

describe('crash-safe promotion journal + recovery (CRASH-SAFE PROMOTION)', () => {
  const { createHash } = require('node:crypto')
  const sha = s => createHash('sha256').update(Buffer.from(s)).digest('hex')

  // Lay a target dir + durable journal into the exact on-disk state a HARD crash
  // (process killed — no in-process rollback) would leave after `state` renames.
  function crashState(state) {
    const target = work()
    const a = path.join(target, 'a.txt')
    const b = path.join(target, 'b.txt')
    const ops = [
      { name: 'a.txt', finalPath: a, stagedPath: path.join(target, '.stage', 'a.txt'), stagedSha: sha('NEW-A'), preExisting: true, backupPath: `${a}.bak-0`, backupSha: sha('OLD-A') },
      { name: 'b.txt', finalPath: b, stagedPath: path.join(target, '.stage', 'b.txt'), stagedSha: sha('NEW-B'), preExisting: true, backupPath: `${b}.bak-1`, backupSha: sha('OLD-B') }
    ]
    // baseline official files
    writeFileSync(a, 'OLD-A'); writeFileSync(b, 'OLD-B')
    if (state >= 1) { renameSync(a, `${a}.bak-0`); writeFileSync(a, 'NEW-A') }        // op0 promoted
    if (state === 2) { renameSync(b, `${b}.bak-1`) }                                   // op1 backup only
    if (state >= 3) { renameSync(b, `${b}.bak-1`); writeFileSync(b, 'NEW-B') }         // op1 promoted too
    writeFileSync(path.join(target, JOURNAL_NAME), JSON.stringify({ version: 1, committed: false, targetDir: target, ops }))
    return { target, a, b }
  }

  for (const state of [0, 1, 2, 3]) {
    it(`recovery rolls an UNCOMMITTED crash (after ${state} rename-steps) back to the original set`, () => {
      const { target, a, b } = crashState(state)
      const r = recoverRelease(target)
      expect(r.action).toBe('rolled-back')
      expect(readFileSync(a, 'utf8')).toBe('OLD-A')
      expect(readFileSync(b, 'utf8')).toBe('OLD-B')
      expect(existsSync(path.join(target, JOURNAL_NAME))).toBe(false)
      // no leftover backups
      expect(existsSync(`${a}.bak-0`)).toBe(false)
      expect(existsSync(`${b}.bak-1`)).toBe(false)
    })
  }

  it('a COMMITTED journal rolls forward: promotions kept, backups + journal discarded', () => {
    const target = work()
    const a = path.join(target, 'a.txt')
    writeFileSync(a, 'NEW-A')            // already promoted
    writeFileSync(`${a}.bak-0`, 'OLD-A') // leftover backup
    const ops = [{ name: 'a.txt', finalPath: a, stagedSha: sha('NEW-A'), preExisting: true, backupPath: `${a}.bak-0`, backupSha: sha('OLD-A') }]
    writeFileSync(path.join(target, JOURNAL_NAME), JSON.stringify({ version: 1, committed: true, targetDir: target, ops }))
    const r = recoverRelease(target)
    expect(r.action).toBe('rolled-forward')
    expect(readFileSync(a, 'utf8')).toBe('NEW-A')
    expect(existsSync(`${a}.bak-0`)).toBe(false)
    expect(existsSync(path.join(target, JOURNAL_NAME))).toBe(false)
  })

  it('no journal → recovery is a no-op', () => {
    const target = work()
    expect(recoverRelease(target)).toEqual({ recovered: false, action: 'none', files: [] })
  })

  it('an UNREADABLE journal throws (never guesses)', () => {
    const target = work()
    writeFileSync(path.join(target, JOURNAL_NAME), '{ this is not json')
    expect(() => recoverRelease(target)).toThrow(/unreadable/)
  })

  it('a real finalizeSidecars run leaves NO journal behind on success', () => {
    const target = work()
    const stg = makeStaging(target)
    const staged = [stageSidecar(stg, 'checksums.json', '{"ok":true}')]
    const r = finalizeSidecars({ stagingDir: stg, targetDir: target, staged, gatePassed: true })
    expect(r.promoted).toBe(true)
    expect(existsSync(path.join(target, JOURNAL_NAME))).toBe(false)
  })
})

describe('symlink safety (finding 11)', () => {
  it('assertNotSymlink rejects a symlinked target', () => {
    const d = work()
    const real = path.join(d, 'real'); writeFileSync(real, 'x')
    const link = path.join(d, 'link')
    try {
      symlinkSync(real, link)
    } catch {
      return // symlink creation needs privilege on Windows; skip if unavailable
    }
    expect(() => assertNotSymlink(link)).toThrow(/symlink/)
  })
})
