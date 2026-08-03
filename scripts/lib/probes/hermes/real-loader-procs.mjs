// Owned-descendant process containment, shared by the real-loader E2E and the
// isolated packaged E2E teardown.
//
// The launched app spawns a tree of children (the Python gateway/backend, node
// helpers, ...). Windows does NOT reparent orphans, so a descendant snapshot
// taken while the app is alive stays valid after it exits. We identify ownership
// by descent from a root PID (or by a unique sandbox path in the command line)
// AND by process IDENTITY (CreationDate + ExecutablePath), so a PID reused by an
// unrelated process after our child exits is never mistakenly killed. A failed
// enumeration is treated as "unknown, fail closed" — NEVER as "nothing alive".

import { spawnSync } from 'node:child_process'

// One row per process: PID \t PPID \t CreationDate(o) \t ExecutablePath \t
// CommandLine. Tabs are safe separators — exe paths contain spaces but not tabs;
// a tab inside the trailing CommandLine field is re-joined at parse time.
const PROC_SCRIPT =
  "Get-CimInstance Win32_Process | ForEach-Object { " +
  "\"$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.CreationDate.ToString('o'))`t$($_.ExecutablePath)`t$($_.CommandLine)\" }"

function ps(script) {
  const out = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  })
  return { ok: out.status === 0, stdout: out.stdout || '', stderr: (out.stderr || '').trim() }
}

/** Parse the CIM proc table into { byPid: Map<pid,{pid,ppid,creation,exe,cmd}>,
 *  parentByPid }. Pure — testable without spawning anything. */
export function parseProcTable(text) {
  const byPid = new Map()
  const parentByPid = {}
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue
    const [pid, ppid, creation, exe, ...cmdParts] = line.split('\t')
    const p = Number(pid)
    if (!Number.isInteger(p) || p <= 0) continue
    byPid.set(p, {
      pid: p,
      ppid: Number(ppid),
      creation: (creation || '').trim(),
      exe: (exe || '').trim(),
      cmd: cmdParts.join('\t').trim()
    })
    parentByPid[p] = Number(ppid)
  }
  return { byPid, parentByPid }
}

/** Walk a { pid -> parentPid } map to every transitive descendant of `rootPid`
 *  (inclusive). Pure; cycle-safe. */
export function descendantsFromMap(rootPid, parentByPid) {
  const childrenOf = new Map()
  for (const [pid, ppid] of Object.entries(parentByPid)) {
    const p = Number(ppid)
    if (!childrenOf.has(p)) childrenOf.set(p, [])
    childrenOf.get(p).push(Number(pid))
  }
  const seen = new Set([Number(rootPid)])
  const stack = [Number(rootPid)]
  while (stack.length) {
    for (const child of childrenOf.get(stack.pop()) || []) {
      if (!seen.has(child)) {
        seen.add(child)
        stack.push(child)
      }
    }
  }
  return [...seen]
}

export function identityMatches(a, b) {
  return Boolean(a && b && a.creation && a.creation === b.creation && (a.exe || '') === (b.exe || ''))
}

/** PURE partition of owned records against the CURRENT process table by identity:
 *  toKill (present, identity matches), reused (PID present but a DIFFERENT process
 *  — never kill), gone (PID absent). */
export function partitionForKill(ownedRecords, currentByPid) {
  const toKill = []
  const reused = []
  const gone = []
  for (const rec of ownedRecords) {
    const cur = currentByPid.get(rec.pid)
    if (!cur) gone.push(rec)
    else if (identityMatches(rec, cur)) toKill.push(rec)
    else reused.push(rec)
  }
  return { toKill, reused, gone }
}

/** Merge two record sets by PID, PREFERRING the prior identity on conflict so a
 *  PID reused between snapshots keeps its original (pre-reuse) identity and is
 *  correctly rejected at kill time. */
export function mergeRecords(prior, fresh) {
  const map = new Map()
  for (const r of fresh || []) map.set(r.pid, r)
  for (const r of prior || []) map.set(r.pid, r)
  return [...map.values()]
}

function currentIdentityMap() {
  const res = ps(PROC_SCRIPT)
  if (!res.ok || !res.stdout.trim()) return { ok: false, byPid: new Map(), error: res.stderr || 'process query failed' }
  return { ok: true, byPid: parseProcTable(res.stdout).byPid }
}

/** Snapshot the inclusive descendant record set of `rootPid` while it is alive.
 *  Returns { ok, records }. ok:false means enumeration failed — the caller must
 *  fail closed, not assume there are no children. */
export function snapshotOwnedProcs(rootPid) {
  if (!rootPid) return { ok: true, records: [] }
  const cur = currentIdentityMap()
  if (!cur.ok) return { ok: false, records: [], error: cur.error }
  const parentByPid = {}
  for (const rec of cur.byPid.values()) parentByPid[rec.pid] = rec.ppid
  const pids = descendantsFromMap(rootPid, parentByPid)
  return { ok: true, records: pids.map(p => cur.byPid.get(p)).filter(Boolean) }
}

/** PURE: PIDs whose command line contains `marker` (case-insensitive — Windows
 *  paths), excluding `excludePid` (the harness itself, defensively). */
export function pidsMatchingCmdline(marker, byPid, { excludePid } = {}) {
  const needle = String(marker || '').toLowerCase()
  if (!needle) return []
  const pids = []
  for (const rec of byPid.values()) {
    if (rec.pid === excludePid) continue
    if ((rec.cmd || '').toLowerCase().includes(needle)) pids.push(rec.pid)
  }
  return pids
}

/**
 * Snapshot every process whose command line contains a run-unique sandbox path
 * (e.g. the `--user-data-dir=<temp>` argument), PLUS its descendants. Ownership
 * anchor of last resort: it recovers a tree we have no PID handle for (a launch
 * that timed out after spawning) as long as the root's command line carries the
 * marker — descendants (a gateway whose command line does NOT carry it) are then
 * owned by descent. Fails closed like snapshotOwnedProcs.
 */
export function snapshotOwnedByCmdline(marker) {
  if (!marker) return { ok: true, records: [] }
  const cur = currentIdentityMap()
  if (!cur.ok) return { ok: false, records: [], error: cur.error }
  const parentByPid = {}
  for (const rec of cur.byPid.values()) parentByPid[rec.pid] = rec.ppid
  const pids = new Set()
  for (const root of pidsMatchingCmdline(marker, cur.byPid, { excludePid: process.pid })) {
    for (const pid of descendantsFromMap(root, parentByPid)) {
      if (pid !== process.pid) pids.add(pid)
    }
  }
  return { ok: true, records: [...pids].map(p => cur.byPid.get(p)).filter(Boolean) }
}

function killByIdentity(rec) {
  const cur = currentIdentityMap()
  if (!cur.ok) return false
  const now = cur.byPid.get(rec.pid)
  if (!now) return true // already gone
  if (!identityMatches(rec, now)) return false // PID reused — refuse to kill
  // /T also reaps the survivor's CURRENT children — owned by descent even when
  // they were spawned after our last snapshot and so have no record of their own.
  spawnSync('taskkill', ['/PID', String(rec.pid), '/T', '/F'], { windowsHide: true })
  const after = currentIdentityMap()
  if (!after.ok) return false
  const post = after.byPid.get(rec.pid)
  return !post || !identityMatches(rec, post)
}

/**
 * After the app is closed: poll owned records until each exits naturally, then
 * force-kill identity-matched survivors. Fails CLOSED on any enumeration error
 * (allExited:false, error set). Returns { owned, survivors, killed, reused,
 * allExited }. Never throws.
 */
export function reapOwned(ownedRecords, { timeoutMs = 12_000 } = {}) {
  const ownedPids = (ownedRecords || []).map(r => r.pid)
  if (!ownedRecords || ownedRecords.length === 0) {
    return { owned: [], survivors: [], killed: [], reused: [], allExited: true }
  }
  const deadline = Date.now() + timeoutMs
  const killed = []
  for (;;) {
    const cur = currentIdentityMap()
    if (!cur.ok) return { owned: ownedPids, survivors: ownedPids, killed, reused: [], allExited: false, error: cur.error }
    const part = partitionForKill(ownedRecords, cur.byPid)
    if (part.toKill.length === 0) {
      return { owned: ownedPids, survivors: [], killed, reused: part.reused.map(r => r.pid), allExited: true }
    }
    if (Date.now() >= deadline) {
      for (const rec of part.toKill) if (killByIdentity(rec)) killed.push(rec.pid)
      const after = currentIdentityMap()
      if (!after.ok) return { owned: ownedPids, survivors: part.toKill.map(r => r.pid), killed, reused: part.reused.map(r => r.pid), allExited: false, error: after.error }
      const still = partitionForKill(ownedRecords, after.byPid).toKill.map(r => r.pid)
      return { owned: ownedPids, survivors: still, killed, reused: part.reused.map(r => r.pid), allExited: still.length === 0 }
    }
    const spin = Date.now() + 400
    while (Date.now() < spin) {
      /* brief wait for natural exit; no async in finally-path cleanup */
    }
  }
}
