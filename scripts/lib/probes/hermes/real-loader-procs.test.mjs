import { describe, expect, it } from 'vitest'
import {
  descendantsFromMap,
  identityMatches,
  mergeRecords,
  parseProcTable,
  partitionForKill,
  reapOwned
} from './real-loader-procs.mjs'

describe('real-loader-procs pure PID-tree logic', () => {
  it('parseProcTable parses pid/ppid/creation/exe with tab-safe exe paths', () => {
    const text = ['100\t4\t2026-08-01T10:00:00.0000000\tC:\\a b\\Hermes.exe', 'bad-line', '200\t100\t2026-08-01T10:01:00.0000000\t'].join('\n')
    const { byPid, parentByPid } = parseProcTable(text)
    expect(byPid.get(100)).toEqual({ pid: 100, ppid: 4, creation: '2026-08-01T10:00:00.0000000', exe: 'C:\\a b\\Hermes.exe' })
    expect(byPid.get(200).exe).toBe('')
    expect(parentByPid[200]).toBe(100)
  })

  it('descendantsFromMap collects the whole subtree inclusive of root, cycle-safe', () => {
    expect(descendantsFromMap(100, { 200: 100, 300: 100, 400: 200, 999: 1 }).sort((a, b) => a - b)).toEqual([100, 200, 300, 400])
    expect(descendantsFromMap(1, { 2: 1, 1: 2 }).sort((a, b) => a - b)).toEqual([1, 2])
    expect(descendantsFromMap(42, { 7: 8 })).toEqual([42])
  })
})

describe('real-loader-procs identity + kill partitioning (PID-reuse safety)', () => {
  const rec = (pid, creation, exe) => ({ pid, creation, exe })

  it('identityMatches requires BOTH creation date and exe path to match', () => {
    expect(identityMatches(rec(1, 'c', 'e'), rec(1, 'c', 'e'))).toBe(true)
    expect(identityMatches(rec(1, 'c', 'e'), rec(1, 'DIFFERENT', 'e'))).toBe(false)
    expect(identityMatches(rec(1, 'c', 'e'), rec(1, 'c', 'other.exe'))).toBe(false)
    expect(identityMatches(rec(1, '', 'e'), rec(1, '', 'e'))).toBe(false) // empty creation is untrusted
  })

  it('partitionForKill only targets identity-matched survivors, spares reused PIDs', () => {
    const owned = [rec(10, 'c10', 'H.exe'), rec(20, 'c20', 'H.exe'), rec(30, 'c30', 'H.exe')]
    const current = new Map([
      [10, rec(10, 'c10', 'H.exe')], // same identity -> kill
      [20, rec(20, 'REUSED', 'evil.exe')] // PID reused by another process -> spare
      // 30 absent -> gone
    ])
    const { toKill, reused, gone } = partitionForKill(owned, current)
    expect(toKill.map(r => r.pid)).toEqual([10])
    expect(reused.map(r => r.pid)).toEqual([20])
    expect(gone.map(r => r.pid)).toEqual([30])
  })

  it('mergeRecords unions by PID and keeps the PRIOR identity on conflict', () => {
    const prior = [rec(1, 'c1', 'H.exe')]
    const fresh = [rec(1, 'REUSED', 'evil.exe'), rec(2, 'c2', 'H.exe')]
    const merged = mergeRecords(prior, fresh).sort((a, b) => a.pid - b.pid)
    expect(merged).toEqual([rec(1, 'c1', 'H.exe'), rec(2, 'c2', 'H.exe')])
  })

  it('reapOwned reports allExited for an empty owned set without spawning', () => {
    expect(reapOwned([])).toEqual({ owned: [], survivors: [], killed: [], reused: [], allExited: true })
  })
})
