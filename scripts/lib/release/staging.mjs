// Atomic, symlink-safe sidecar staging + TOCTOU-resistant promotion.
//
// The incident this closes: acceptance/checksum sidecars were written directly
// into release/ as the pipeline ran, so a build whose FINAL gate later failed
// could still leave a fresh-looking official `ACCEPTANCE.md` / `checksums.json`
// behind. Fix: every sidecar is written into a freshly-created, verified
// NON-SYMLINK staging dir on the SAME volume as release/, hashed, and only
// renamed into place AFTER the final gate passes — all-or-nothing. A failed gate
// discards the staging dir and leaves the prior official sidecars untouched.
//
// TOCTOU: candidate artifacts are hashed into staging and RE-HASHED at promotion;
// a mid-run mutation makes the re-hash disagree and the promotion is refused.

import { createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** Durable, fsynced write: bytes hit stable storage before the call returns, so a
 * crash immediately after cannot leave a torn/absent journal. */
function writeSync(file, content) {
  const fd = openSync(file, 'w')
  try {
    writeFileSync(fd, content)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** The crash-safe promotion journal filename inside the release dir. */
export const JOURNAL_NAME = '.release-promote-journal.json'

function fileSha(p) {
  try { return sha256(readFileSync(p)) } catch { return null }
}

/** Throw if `p` exists and is a symlink/reparse point (never follow it). */
export function assertNotSymlink(p) {
  if (existsSync(p) && lstatSync(p).isSymbolicLink()) {
    throw new Error(`refusing to operate on symlink: ${p}`)
  }
}

/** Create a staging dir inside `baseDir` (same volume → atomic rename). Verifies
 * baseDir is a real directory, not a symlink. Returns the staging path. */
export function makeStaging(baseDir) {
  assertNotSymlink(baseDir)
  mkdirSync(baseDir, { recursive: true })
  return mkdtempSync(path.join(baseDir, '.stage-'))
}

/** Write one sidecar into staging; returns { name, path, sha256, bytes }. */
export function stageSidecar(stagingDir, name, content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content))
  const p = path.join(stagingDir, name)
  writeFileSync(p, buf)
  return { name, path: p, sha256: sha256(buf), bytes: buf.length }
}

/** Hash a candidate artifact into an immutable record for later re-verification. */
export function fingerprintCandidate(file) {
  const buf = readFileSync(file)
  return { path: file, sha256: sha256(buf), bytes: buf.length }
}

/** Re-hash a candidate and confirm it is byte-identical to its fingerprint. */
export function candidateUnchanged(fp) {
  try {
    const buf = readFileSync(fp.path)
    return buf.length === fp.bytes && sha256(buf) === fp.sha256
  } catch {
    return false
  }
}

/** Atomically move a staged file to its final path (both verified non-symlink). */
export function promoteStaged(stagedPath, finalPath) {
  assertNotSymlink(finalPath)
  // Open+close to assert the staged bytes are still readable right before rename.
  closeSync(openSync(stagedPath, 'r'))
  renameSync(stagedPath, finalPath)
}

/**
 * Promote a set of staged sidecars to `targetDir` as a CRASH-SAFE TRANSACTION
 * (HIGH 8 + CRASH-SAFE PROMOTION):
 *   1. gate + TOCTOU guard: only when `gatePassed` is true AND every guarded
 *      candidate is still byte-identical to its fingerprint;
 *   2. a durable, fsynced JOURNAL (target/.release-promote-journal.json) recording
 *      the exact plan — every staged sha and every pre-image (backup) sha — is
 *      written BEFORE the first rename, so a hard crash mid-batch is recoverable;
 *   3. each existing official file is renamed to a backup, then the staged file is
 *      renamed into place; on ANY in-process failure the whole batch rolls back
 *      with VERIFIED restores (a restore whose bytes do not match the recorded
 *      pre-image sha THROWS — never silently swallowed);
 *   4. commit: the journal is marked committed+fsynced, then backups and journal
 *      are discarded. If the process dies before cleanup, recoverRelease() finishes
 *      the roll-forward on next launch; if it dies before commit, recoverRelease()
 *      rolls the batch back.
 *   staged     : [{ name, path, sha256 }] (from stageSidecar) — INCLUDES
 *                release-report.json so the report is promoted in the SAME
 *                transaction, never overwritten directly.
 *   candidates : [fingerprint] (from fingerprintCandidate) to re-verify
 *   promote    : injectable rename (defaults to promoteStaged) — tests force a
 *                mid-batch failure to exercise crash rollback.
 * Returns { promoted:boolean, reason?, files:string[] }.
 */
export function finalizeSidecars({ stagingDir, targetDir, staged, candidates = [], gatePassed, promote = promoteStaged }) {
  const cleanup = () => rmSync(stagingDir, { recursive: true, force: true })
  if (!gatePassed) {
    cleanup()
    return { promoted: false, reason: 'gate-failed', files: [] }
  }
  const mutated = candidates.find(c => !candidateUnchanged(c))
  if (mutated) {
    cleanup()
    return { promoted: false, reason: `candidate mutated mid-run: ${path.basename(mutated.path)}`, files: [] }
  }

  // Build the plan + durable journal BEFORE any rename.
  const journalPath = path.join(targetDir, JOURNAL_NAME)
  const ops = staged.map((s, i) => {
    const finalPath = path.join(targetDir, s.name)
    const preExisting = existsSync(finalPath)
    return {
      name: s.name,
      stagedPath: s.path,
      finalPath,
      stagedSha: s.sha256 || fileSha(s.path),
      preExisting,
      backupPath: preExisting ? `${finalPath}.bak-${i}` : null,
      backupSha: preExisting ? fileSha(finalPath) : null
    }
  })
  writeSync(journalPath, `${JSON.stringify({ version: 1, committed: false, targetDir, ops }, null, 2)}\n`)

  const backups = [] // { finalPath, backupPath, backupSha }
  const promoted = [] // finalPath
  try {
    for (const op of ops) {
      if (op.preExisting) {
        assertNotSymlink(op.finalPath)
        renameSync(op.finalPath, op.backupPath)
        backups.push(op)
      }
      promote(op.stagedPath, op.finalPath)
      promoted.push(op.finalPath)
    }
  } catch (e) {
    // Crash rollback IN PROCESS: undo promoted files, restore every backup and
    // VERIFY each restore against its recorded pre-image sha (no swallowed errors).
    for (const p of promoted) rmSync(p, { force: true })
    const restoreErrors = []
    for (const op of backups) {
      try {
        if (existsSync(op.finalPath)) rmSync(op.finalPath, { force: true })
        renameSync(op.backupPath, op.finalPath)
        const got = fileSha(op.finalPath)
        if (op.backupSha && got !== op.backupSha) throw new Error(`restored ${op.name} sha ${got} != pre-image ${op.backupSha}`)
      } catch (re) {
        restoreErrors.push(`${op.name}: ${re.message}`)
      }
    }
    rmSync(journalPath, { force: true })
    cleanup()
    if (restoreErrors.length) {
      // A failed restore is NEVER swallowed — surface it loudly.
      throw new Error(`promotion failed AND rollback could not fully restore: ${restoreErrors.join('; ')} (original: ${e.message})`)
    }
    return { promoted: false, reason: `promotion failed, rolled back (verified): ${e.message}`, files: [] }
  }

  // Commit point: mark the journal committed+fsynced, THEN discard backups + journal.
  writeSync(journalPath, `${JSON.stringify({ version: 1, committed: true, targetDir, ops }, null, 2)}\n`)
  for (const op of backups) rmSync(op.backupPath, { force: true })
  rmSync(journalPath, { force: true })
  cleanup()
  return { promoted: true, files: promoted.map(p => path.basename(p)) }
}

/**
 * Recover an interrupted promotion on next launch (CRASH-SAFE PROMOTION). Reads the
 * durable journal in `targetDir`, if any:
 *   - committed:true  → the batch was fully promoted before the crash; finish the
 *     roll-FORWARD by discarding leftover backups + journal.
 *   - committed:false → the batch was interrupted mid-rename; roll BACK — remove any
 *     promoted staged bytes, restore every backup and VERIFY each against its recorded
 *     pre-image sha (a mismatch or failed restore THROWS, never swallowed).
 * Returns { recovered:boolean, action:'none'|'rolled-forward'|'rolled-back', files }.
 */
export function recoverRelease(targetDir) {
  const journalPath = path.join(targetDir, JOURNAL_NAME)
  if (!existsSync(journalPath)) return { recovered: false, action: 'none', files: [] }
  let journal
  try { journal = JSON.parse(readFileSync(journalPath, 'utf8')) } catch (e) {
    throw new Error(`release promotion journal is unreadable (${e.message}); refusing to guess — inspect ${journalPath} by hand`)
  }
  const ops = Array.isArray(journal.ops) ? journal.ops : []
  if (journal.committed === true) {
    // Roll forward: promotions are in place; just clean up leftovers.
    for (const op of ops) if (op.backupPath && existsSync(op.backupPath)) rmSync(op.backupPath, { force: true })
    rmSync(journalPath, { force: true })
    return { recovered: true, action: 'rolled-forward', files: ops.map(o => o.name) }
  }
  // Roll back (uncommitted): reverse order, remove partial promotions, restore backups.
  const restored = []
  for (const op of [...ops].reverse()) {
    // A staged file that made it to finalPath (sha == stagedSha) is a partial
    // promotion — remove it so the backup can be restored.
    if (existsSync(op.finalPath) && op.stagedSha && fileSha(op.finalPath) === op.stagedSha) {
      rmSync(op.finalPath, { force: true })
    }
    if (op.backupPath && existsSync(op.backupPath)) {
      if (existsSync(op.finalPath)) rmSync(op.finalPath, { force: true })
      renameSync(op.backupPath, op.finalPath)
      const got = fileSha(op.finalPath)
      if (op.backupSha && got !== op.backupSha) {
        throw new Error(`recovery: restored ${op.name} sha ${got} != journal pre-image ${op.backupSha} — refusing to leave a corrupt official set`)
      }
      restored.push(op.name)
    }
  }
  rmSync(journalPath, { force: true })
  return { recovered: true, action: 'rolled-back', files: restored }
}
