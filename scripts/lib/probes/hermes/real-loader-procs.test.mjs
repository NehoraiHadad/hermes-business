import { describe, expect, it } from 'vitest'
import {
  descendantsFromMap,
  identityMatches,
  mergeRecords,
  parseProcTable,
  partitionForKill,
  pidsMatchingCmdline,
  reapOwned
} from './real-loader-procs.mjs'

describe('real-loader-procs pure PID-tree logic', () => {
  it('parseProcTable parses pid/ppid/creation/exe/cmd; tabs inside cmd are re-joined', () => {
    const text = [
      '100\t4\t2026-08-01T10:00:00.0000000\tC:\\a b\\Hermes.exe\t"C:\\a b\\Hermes.exe" --user-data-dir=C:\\t\\ud',
      'bad-line',
      '200\t100\t2026-08-01T10:01:00.0000000\t\tweird\tcmd',
      '300\t100\t2026-08-01T10:02:00.0000000\tC:\\py\\python.exe'
    ].join('\n')
    const { byPid, parentByPid } = parseProcTable(text)
    expect(byPid.get(100)).toEqual({
      pid: 100,
      ppid: 4,
      creation: '2026-08-01T10:00:00.0000000',
      exe: 'C:\\a b\\Hermes.exe',
      cmd: '"C:\\a b\\Hermes.exe" --user-data-dir=C:\\t\\ud'
    })
    expect(byPid.get(200).exe).toBe('')
    expect(byPid.get(200).cmd).toBe('weird\tcmd')
    expect(byPid.get(300).cmd).toBe('') // legacy 4-column row stays parseable
    expect(parentByPid[200]).toBe(100)
  })

  it('pidsMatchingCmdline matches case-insensitively and spares the excluded PID', () => {
    const { byPid } = parseProcTable(
      [
        '100\t4\tc\tH.exe\t"H.exe" --user-data-dir=C:\\Temp\\HERMES-ISO-E2E-1',
        '200\t100\tc\tpy.exe\tpython -m hermes_cli.main gateway run',
        '300\t4\tc\tme.exe\tnode e2e --marker c:\\temp\\hermes-iso-e2e-1'
      ].join('\n')
    )
    expect(pidsMatchingCmdline('c:\\temp\\hermes-iso-e2e-1', byPid)).toEqual([100, 300])
    expect(pidsMatchingCmdline('c:\\temp\\hermes-iso-e2e-1', byPid, { excludePid: 300 })).toEqual([100])
    expect(pidsMatchingCmdline('', byPid)).toEqual([])
  })

  it('descendantsFromMap collects the whole subtree inclusive of root, cycle-safe', () => {
    expect(descendantsFromMap(100, { 200: 100, 300: 100, 400: 200, 999: 1 }).sort((a, b) => a - b)).toEqual([100, 200, 300, 400])
    expect(descendantsFromMap(1, { 2: 1, 1: 2 }).sort((a, b) => a - b)).toEqual([1, 2])
    expect(descendantsFromMap(42, { 7: 8 })).toEqual([42])
  })

  it('with identities, refuses a PPID edge whose child predates the parent (recycled PID)', () => {
    // Live incident 2026-08-17: an owned process received the recycled PID of a
    // long-dead boot process, so csrss/winlogon (created at boot, PPID now
    // colliding with ours) joined the owned tree and their children with them.
    const id = (pid, creation) => [pid, { pid, creation, exe: 'x' }]
    const byPid = new Map([
      id(100, '2026-08-17T16:20:00.000+03:00'), // our root, created today
      id(200, '2026-08-17T16:20:01.000+03:00'), // real child — after parent
      id(888, '2026-08-16T20:17:38.000+03:00'), // "child" created YESTERDAY — recycled PPID
      id(1436, '2026-08-16T20:17:46.000+03:00') // its descendant must not join either
    ])
    const parents = { 200: 100, 888: 100, 1436: 888 }
    expect(descendantsFromMap(100, parents, byPid).sort((a, b) => a - b)).toEqual([100, 200])
    // equal creation timestamps stay owned (same-millisecond spawn)
    const tie = new Map([id(1, '2026-08-17T10:00:00.000+03:00'), id(2, '2026-08-17T10:00:00.000+03:00')])
    expect(descendantsFromMap(1, { 2: 1 }, tie).sort((a, b) => a - b)).toEqual([1, 2])
    // unparseable/missing identity on either side: the edge is refused, never adopted
    const bad = new Map([id(1, 'not-a-date'), id(2, '2026-08-17T10:00:00.000+03:00')])
    expect(descendantsFromMap(1, { 2: 1, 3: 2 }, bad)).toEqual([1])
    // without identities the walk is unchanged (pure PPID descent)
    expect(descendantsFromMap(100, parents).sort((a, b) => a - b)).toEqual([100, 200, 888, 1436])
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
