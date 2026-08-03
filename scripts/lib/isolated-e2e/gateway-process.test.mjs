import { describe, expect, it, vi } from 'vitest'
import { captureOwnedRecords, readOwnedGatewayPid, reapOwnedGateway } from './gateway-process.mjs'

const home = 'C:\\Temp\\hermes-qa-home-safe'
const record = value => () => JSON.stringify(value)

describe('isolated gateway PID ownership', () => {
  it('accepts only a positive PID owned by the exact temporary Hermes home', () => {
    expect(readOwnedGatewayPid(home, record({ pid: 1234, hermes_home: home.toLowerCase() }))).toBe(1234)
    expect(readOwnedGatewayPid(home, record({ pid: 1234, hermes_home: 'C:\\Users\\live\\hermes' }))).toBeNull()
    expect(readOwnedGatewayPid(home, record({ pid: -1, hermes_home: home }))).toBeNull()
  })

  it('never reaps an unowned or malformed PID record', () => {
    const reap = vi.fn(() => true)
    expect(reapOwnedGateway(home, { read: record({ pid: 9, hermes_home: 'C:\\other' }), reap })).toEqual({ pid: null, reaped: false })
    expect(reap).not.toHaveBeenCalled()
  })

  it('reaps the owned gateway tree', () => {
    const reap = vi.fn(() => true)
    expect(reapOwnedGateway(home, { read: record({ pid: 4321, hermes_home: home }), reap })).toEqual({ pid: 4321, reaped: true })
    expect(reap).toHaveBeenCalledWith({ pid: 4321 })
  })
})

describe('captureOwnedRecords (identity snapshot of everything this run owns)', () => {
  const rec = (pid, creation = 'c', exe = 'x.exe') => ({ pid, creation, exe })

  it('is not applicable off Windows and never spawns a snapshot', () => {
    const snapshotPid = vi.fn()
    const result = captureOwnedRecords({ rootPids: [1], cmdlineMarkers: ['m'], platform: 'linux', snapshotPid })
    expect(result).toEqual({ applicable: false, ok: true, records: [] })
    expect(snapshotPid).not.toHaveBeenCalled()
  })

  it('merges PID-descent and cmdline-marker snapshots, skipping falsy roots/markers', () => {
    const snapshotPid = vi.fn(() => ({ ok: true, records: [rec(10), rec(20)] }))
    const snapshotCmdline = vi.fn(() => ({ ok: true, records: [rec(30)] }))
    const result = captureOwnedRecords({
      rootPids: [100, null, undefined],
      cmdlineMarkers: ['C:\\Temp\\ud', ''],
      platform: 'win32',
      snapshotPid,
      snapshotCmdline
    })
    expect(snapshotPid).toHaveBeenCalledTimes(1)
    expect(snapshotCmdline).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    expect(result.records.map(r => r.pid).sort((a, b) => a - b)).toEqual([10, 20, 30])
  })

  it('prefers the PRIOR identity on a PID conflict (reuse between snapshots)', () => {
    const prior = { applicable: true, ok: true, records: [rec(10, 'orig', 'ours.exe')] }
    const snapshotPid = vi.fn(() => ({ ok: true, records: [rec(10, 'REUSED', 'evil.exe')] }))
    const result = captureOwnedRecords({ prior, rootPids: [100], platform: 'win32', snapshotPid })
    expect(result.records).toEqual([rec(10, 'orig', 'ours.exe')])
  })

  it('a single failed enumeration marks the capture unverifiable (sticky ok:false)', () => {
    const snapshotPid = vi.fn(() => ({ ok: false, records: [], error: 'boom' }))
    const snapshotCmdline = vi.fn(() => ({ ok: true, records: [rec(30)] }))
    const failed = captureOwnedRecords({ rootPids: [100], cmdlineMarkers: ['m'], platform: 'win32', snapshotPid, snapshotCmdline })
    expect(failed.ok).toBe(false)
    expect(failed.records.map(r => r.pid)).toEqual([30]) // still keeps what it could see
    // ...and ok:false stays false on a later successful refresh.
    const refreshed = captureOwnedRecords({
      prior: failed,
      rootPids: [100],
      platform: 'win32',
      snapshotPid: vi.fn(() => ({ ok: true, records: [rec(40)] }))
    })
    expect(refreshed.ok).toBe(false)
    expect(refreshed.records.map(r => r.pid).sort((a, b) => a - b)).toEqual([30, 40])
  })
})
