// Reap a detached Hermes gateway by its profile-owned PID record. On Windows the
// venv launcher can outlive/reparent away from Electron, so the Electron process
// tree alone is not an authoritative lifecycle boundary.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { reapProcessTree } from '../../../electron/process-util.cjs'

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
