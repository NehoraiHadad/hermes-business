// Reap a detached Hermes gateway by its profile-owned PID record. On Windows the
// venv launcher can outlive/reparent away from Electron, so the Electron process
// tree alone is not an authoritative lifecycle boundary. captureOwnedRecords
// additionally snapshots every owned process by IDENTITY (creation + exe) while
// it is still alive, so teardown can positively verify the whole tree died —
// the gateway's own command line carries no temp-home marker, so identity
// records taken by descent are the only reliable post-mortem handle on it.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { reapProcessTree } from '../../../electron/process-util.cjs'
import {
  mergeRecords,
  snapshotOwnedByCmdline,
  snapshotOwnedProcs
} from '../probes/hermes/real-loader-procs.mjs'

function pathKey(value) {
  return path.resolve(String(value || '')).replace(/[\\/]+$/, '').toLowerCase()
}

export function readOwnedGatewayPid(tempHome, read = readFileSync) {
  try {
    const record = JSON.parse(read(path.join(tempHome, 'gateway.pid'), 'utf8'))
    const pid = Number(record?.pid)
    if (!Number.isSafeInteger(pid) || pid <= 0) return null
    if (pathKey(record?.hermes_home) !== pathKey(tempHome)) return null
    return pid
  } catch {
    return null
  }
}

export function reapOwnedGateway(tempHome, { read = readFileSync, reap = reapProcessTree } = {}) {
  const pid = readOwnedGatewayPid(tempHome, read)
  return { pid, reaped: pid !== null ? Boolean(reap({ pid })) : false }
}

/**
 * Snapshot (or refresh) the identity records of every process this run owns:
 * the descendants of each `rootPids` entry (the Electron main PID, the
 * profile-owned gateway PID) plus any process whose command line carries one of
 * `cmdlineMarkers` (the run-unique temp userData path) and ITS descendants.
 * Merging prefers the PRIOR identity on a PID conflict, so a PID reused between
 * snapshots keeps its original identity and is refused at kill time. `ok` is
 * sticky-false: one failed enumeration marks the whole capture unverifiable and
 * the teardown verdict fails closed.
 */
export function captureOwnedRecords({
  prior = null,
  rootPids = [],
  cmdlineMarkers = [],
  platform = process.platform,
  snapshotPid = snapshotOwnedProcs,
  snapshotCmdline = snapshotOwnedByCmdline
} = {}) {
  if (platform !== 'win32') return { applicable: false, ok: true, records: prior?.records || [] }
  let ok = prior ? prior.ok !== false : true
  let records = prior?.records || []
  const snapshots = [
    ...rootPids.filter(Boolean).map(pid => () => snapshotPid(pid)),
    ...cmdlineMarkers.filter(Boolean).map(marker => () => snapshotCmdline(marker))
  ]
  for (const take of snapshots) {
    const snap = take()
    if (snap.ok) records = mergeRecords(records, snap.records)
    else ok = false
  }
  return { applicable: true, ok, records }
}
