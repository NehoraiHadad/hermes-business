// TEARDOWN + FORENSIC PRESERVATION for the isolated packaged E2E.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { reapProcessTree } from '../../../electron/process-util.cjs'
import { safeJson } from '../e2e-harness.mjs'
import { isPortFree, removeTempHome } from '../isolated-runtime.mjs'
import { hermesHomeMarker, markerDelta } from '../isolated-marker.mjs'

/** Reap any hermes process bound to the isolated port (belt-and-suspenders). */
export function killIsolatedPortProcess(isolatedPort) {
  if (process.platform !== 'win32') return
  const out = spawnSync('cmd', ['/c', `netstat -ano | findstr :${isolatedPort}`], { encoding: 'utf8' })
  const pids = new Set()
  for (const line of String(out.stdout || '').split(/\r?\n/)) {
    const m = line.trim().match(/LISTENING\s+(\d+)\s*$/)
    if (m) pids.add(m[1])
  }
  for (const pid of pids) reapProcessTree({ pid: Number(pid) })
}

/**
 * If the live profile's DEFINING state moved at all, STOP and preserve a
 * redacted, hash-only forensic report. We NEVER auto-restore: the before-marker
 * is a sha256 fingerprint (not the exact bytes) and a concurrently-running live
 * gateway may have made its own legitimate writes, so overwriting the live
 * profile could destroy real user state. Restoration is only ever safe with an
 * exact byte-snapshot AND a mutation conclusively attributable to this run —
 * neither is available here. Returns the teardown patch to merge into the report.
 */
export function preserveForensicsIfMutated({ forensicDir, delta, liveUntouched, liveMarkerBefore, liveMarkerAfter, runApproval }) {
  if (!(delta.config_changed || !liveUntouched)) return {}
  try {
    mkdirSync(forensicDir, { recursive: true })
    const forensic = {
      kind: 'live-profile-mutation',
      detected_at_run_pid: process.pid,
      approval_requested: runApproval,
      note: 'Redacted, hash/inventory-only. No config contents, credentials or paths.',
      auto_restore_performed: false,
      auto_restore_withheld_reason:
        'before-snapshot is a sha256 marker (not exact bytes); mutation not conclusively isolatable from concurrent live-gateway writes',
      config_changed: delta.config_changed,
      config_hash_before: liveMarkerBefore._configHash,
      config_hash_after: liveMarkerAfter._configHash,
      stable_marker_before: liveMarkerBefore.digest,
      stable_marker_after: liveMarkerAfter.digest,
      stable_marker_equal: delta.digest_equal,
      profile_defining_unchanged: delta.profile_defining_unchanged,
      structural_added_removed: delta.added_removed,
      stable_structural_changed: delta.stable_structural_changed,
      stable_content_changed: delta.stable_content_changed,
      stable_unsafe_entries: delta.stable_unsafe_entries,
      volatile_runtime_changes: delta.volatile_runtime_changes,
      inventory_before: liveMarkerBefore.inventory,
      inventory_after: liveMarkerAfter.inventory
    }
    const outPath = path.join(forensicDir, `live-mutation-${process.pid}.json`)
    writeFileSync(outPath, `${safeJson(forensic)}\n`)
    return { forensic_report: path.basename(outPath), live_mutation_preserved: true }
  } catch (e) {
    return { forensic_report_error: String(e?.message || e) }
  }
}

/** Give the OS a beat to release the port and file locks after close. */
function osReleaseBeat() {
  spawnSync(
    process.platform === 'win32' ? 'cmd' : 'sleep',
    process.platform === 'win32' ? ['/c', 'ping', '-n', '3', '127.0.0.1'] : ['1'],
    { stdio: 'ignore' }
  )
}

/**
 * Reap the port, remove the temp home, re-snapshot the live marker and assemble
 * the teardown verdict — mutating `report.teardown` and re-deriving `report.ok`.
 * Isolation is only truly proven if the live profile's DEFINING state is
 * unchanged (a pure session-count drift is the user's own live gateway on 9119,
 * which we never touched) AND we left no residue behind.
 */
export async function finalizeTeardown({
  report,
  tempHome,
  isolatedPort,
  liveHome,
  liveMarkerBefore,
  probePath,
  forensicDir,
  runApproval
}) {
  killIsolatedPortProcess(isolatedPort)
  osReleaseBeat()
  const removed = removeTempHome(tempHome)
  const portFree = await isPortFree(isolatedPort)
  const liveMarkerAfter = hermesHomeMarker(liveHome)
  const delta = markerDelta(liveMarkerBefore, liveMarkerAfter)
  // `live_home_untouched` and `live_marker_exact_equal` are the STABLE invariant
  // (config + protected name-sets + stable-content sizes) — equal by construction.
  // Volatile live-gateway churn (session/cron runtime bookkeeping) is disclosed
  // separately and never blocks a pass; a stable/config/session-structural/skills
  // mutation fails both, and unknown drift fails closed via the stable digest.
  const liveUntouched = delta.profile_defining_unchanged
  report.teardown = {
    temp_home_removed: removed.removed,
    isolated_port_free: portFree,
    live_home_untouched: liveUntouched,
    live_marker_exact_equal: delta.digest_equal,
    live_config_unchanged: !delta.config_changed,
    live_added_removed: delta.added_removed,
    live_stable_structural_changed: delta.stable_structural_changed,
    live_stable_content_changed: delta.stable_content_changed,
    live_stable_unsafe_entries: delta.stable_unsafe_entries,
    live_volatile_runtime_changes: delta.volatile_runtime_changes,
    probe_file_absent: !existsSync(probePath)
  }
  report.ok = Boolean(
    report.ok &&
      liveUntouched &&
      delta.digest_equal &&
      delta.stable_unsafe_entries === 0 &&
      removed.removed &&
      portFree &&
      report.teardown.probe_file_absent
  )
  Object.assign(
    report.teardown,
    preserveForensicsIfMutated({ forensicDir, delta, liveUntouched, liveMarkerBefore, liveMarkerAfter, runApproval })
  )
}
