// TEARDOWN + FORENSIC PRESERVATION for the isolated packaged E2E.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { reapProcessTree } from '../../../electron/process-util.cjs'
import { safeJson } from '../e2e-harness.mjs'
import { isPortFree, removeTempHome } from '../isolated-runtime.mjs'
import { hermesHomeMarker, markerDelta } from '../isolated-marker.mjs'
import { reapOwned } from '../probes/hermes/real-loader-procs.mjs'
import { reapOwnedGateway } from './gateway-process.mjs'

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

/** Give Windows a beat to release handles a just-reaped process still holds. */
function osReleaseBeat(ms = 1_000) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Positively verify every OWNED process identity (captured while the app was
 * alive) is dead, force-killing identity-matched survivors, then remove the temp
 * home — interleaving further kill rounds with removal retries. This is what
 * guarantees a detached `gateway run` python (whose command line carries no
 * temp-home marker and whose exe is the LIVE install's venv python) cannot
 * survive the run and hold locks under the temp home. Fail-closed on every
 * axis: `treeDead` is true ONLY when the snapshot succeeded AND every recorded
 * identity is verified gone; `removed` reports only what is actually on disk.
 */
export async function reapOwnedTreeAndRemoveHome({
  tempHome,
  isolatedPort,
  ownedProcs,
  platform = process.platform,
  reapFn = reapOwned,
  removeFn = removeTempHome,
  killPortFn = killIsolatedPortProcess,
  sleepFn = osReleaseBeat,
  rounds = 3,
  naturalExitMs = 2_500
} = {}) {
  const applicable = platform === 'win32'
  const snapshotOk = applicable ? Boolean(ownedProcs && ownedProcs.ok) : null
  const records = ownedProcs?.records || []
  let verdict = null
  if (applicable) verdict = reapFn(records, { timeoutMs: naturalExitMs })
  let removed = await removeFn(tempHome)
  let removalRounds = 0
  while (!removed.removed && removalRounds < rounds) {
    removalRounds += 1
    // A lock holder survived the first pass — force-kill immediately (no
    // natural-exit grace; the app was already reaped) and retry the removal.
    if (applicable) verdict = reapFn(records, { timeoutMs: 0 })
    killPortFn(isolatedPort)
    await sleepFn(1_000)
    removed = await removeFn(tempHome)
  }
  return {
    applicable,
    snapshotOk,
    treeDead: applicable ? Boolean(snapshotOk && verdict && verdict.allExited === true) : null,
    survivors: verdict?.survivors || [],
    killed: verdict?.killed || [],
    ownedCount: records.length,
    removalRounds,
    removed
  }
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
  runApproval,
  ownedProcs = null
}) {
  // Hermes' Windows venv launcher can detach/reparent away from Electron. Its
  // profile-owned PID record is therefore the authoritative second teardown
  // boundary; ownership validation prevents ever touching the live gateway.
  const gateway = reapOwnedGateway(tempHome)
  killIsolatedPortProcess(isolatedPort)
  await osReleaseBeat()
  // Third boundary — identity-checked containment: every descendant snapshotted
  // while the app was alive must be VERIFIED dead (survivors are force-killed,
  // PID reuse refused), with kill rounds interleaved into removal retries.
  const containment = await reapOwnedTreeAndRemoveHome({ tempHome, isolatedPort, ownedProcs })
  const removed = containment.removed
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
    isolated_gateway_pid_found: gateway.pid !== null,
    isolated_gateway_reaped: gateway.reaped,
    owned_tracking_applicable: containment.applicable,
    owned_snapshot_ok: containment.snapshotOk,
    owned_proc_count: containment.ownedCount,
    owned_tree_dead: containment.treeDead,
    owned_tree_survivors: containment.survivors,
    owned_tree_killed: containment.killed,
    temp_home_removal_rounds: containment.removalRounds,
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
      // On Windows the owned tree must be POSITIVELY verified dead — a failed
      // snapshot or a surviving identity fails the run even with the home gone.
      (containment.applicable ? containment.treeDead === true : true) &&
      report.teardown.probe_file_absent
  )
  Object.assign(
    report.teardown,
    preserveForensicsIfMutated({ forensicDir, delta, liveUntouched, liveMarkerBefore, liveMarkerAfter, runApproval })
  )
}
