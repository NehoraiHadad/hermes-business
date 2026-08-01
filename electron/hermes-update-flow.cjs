const { stopOfficialSurfaces, recoverRuntime, closeDesktopScript } = require('./update-runtime.cjs')

// Pure orchestration of the official Hermes self-update. Every side-effecting
// collaborator (process spawns, runtime lifecycle, backup, rollback, health
// probes, the on-disk journal) is passed in via `deps`, so the exact ordering —
// preflight → begin journal → stop → backup → mutate → recover(both healths) →
// verify → clear, with a bounded rollback on post-mutation failure — is
// unit-testable without a live Hermes, git checkout, or Electron.
// `hermes-update.cjs` wires the real collaborators; tests inject fakes. The
// runtime-lifecycle helpers that bracket the transaction (stopOfficialSurfaces,
// recoverRuntime) live in update-runtime.cjs.

async function runOfficialUpdate(deps) {
  const {
    findHermes,
    getHermesVersion,
    runCaptured,
    rememberLog,
    assertUpdateMethodSupported,
    assertReleaseReachable,
    assertUpdateTargetSupported,
    assertRunningVersionSupported,
    createPreUpdateBackup,
    captureRollbackAnchor,
    rollbackAfterFailedUpdate,
    journal
  } = deps

  const command = findHermes()
  if (!command) throw new Error('Hermes אינו מותקן')

  let updated = false
  let began = false
  let backupPath = null
  let anchor = null
  let success = null

  try {
    // --- PREFLIGHT (before stopping anything / before any backup / no journal) ---
    // 1. Gate an install method we cannot both preflight AND automatically roll
    //    back (managed/non-git refuse here — see hermes-compat.cjs).
    const method = assertUpdateMethodSupported(command)
    // 2. Detect offline / release-unreachable. `update --check` AND (for git) the
    //    origin fetch must actually reach the source — failures abort here and are
    //    NEVER swallowed into a mutation attempt.
    await assertReleaseReachable(command)
    // 3. A git install must not silently cross the tested 0.20 boundary.
    const { target } = assertUpdateTargetSupported(command)
    // 4. Capture the exact commit to roll back to — still before any mutation.
    anchor = captureRollbackAnchor(command).anchor

    // --- DURABLE JOURNAL (opened before the first side effect) ---
    // Records method/anchor/versions/backup/phase atomically so an interrupted
    // update (crash/power-loss) is detected and recovered on the next launch.
    journal.beginUpdate({
      method,
      anchor,
      currentVersion: getHermesVersion(command),
      targetVersion: target || null
    })
    began = true

    // --- MUTATION PHASE ---
    journal.updatePhase('stopping')
    await stopOfficialSurfaces(command, deps)
    // Explicit full ZIP backup, verified (central directory parses, non-empty)
    // before we let the update proceed.
    journal.updatePhase('backup')
    backupPath = await createPreUpdateBackup(command)
    // Mark the mutation boundary BEFORE invoking `update --yes`: once it starts,
    // the checkout may already be dirtied, so ANY failure from here on must go
    // through rollback rather than being treated as a no-op preflight failure.
    // The verified backup path is recorded on this same transition so a
    // post-mutation fail-closed can name it.
    updated = true
    journal.updatePhase('mutating', { backupPath })
    await runCaptured(command, ['update', '--yes'], 20 * 60_000)

    // Recover both health surfaces (foreground serve + gateway deep) BEFORE any
    // success is reported.
    journal.updatePhase('recovering')
    const { runtime } = await recoverRuntime(command, deps)
    // POST-UPDATE RE-GATE (authoritative): resolve the version Hermes ACTUALLY
    // runs now and enforce hermes-compat.json before reporting success. Throwing
    // routes into the post-mutation branch below, which rolls back to the anchor.
    journal.updatePhase('verifying')
    const version = getHermesVersion(command)
    assertRunningVersionSupported(version)
    // Both runtime and gateway deep health passed AND the running version is
    // supported → the update itself has SUCCEEDED. Capture the result now, but
    // defer the journal clear to AFTER this try/catch so a (rare) inability to
    // verifiably remove the active journal cannot roll back a healthy install.
    success = { ok: true, completed: true, version, backupPath, runtime }
  } catch (error) {
    const original = error.message || String(error)
    if (began) journal.recordFailure(error)

    if (updated) {
      // Failure AFTER the install was mutated: attempt the safe, bounded rollback
      // (git reset to the anchor; non-git → fail closed).
      const outcome = rollbackAfterFailedUpdate({ command, anchor, backupPath })
      let recovered = false
      try {
        await recoverRuntime(command, deps)
        recovered = true
      } catch (recoveryError) {
        rememberLog(`Post-rollback recovery failed: ${recoveryError.message || recoveryError}`)
        journal.recordFailure(recoveryError)
      }
      if (outcome.restored && recovered) {
        // Restored AND both healths pass → clear the journal (rolled-back outcome).
        // A clear that can't verify removal is logged but must not mask the
        // accurate rolled-back message: launch-time recovery will re-check health
        // and clear the surviving journal safely.
        try {
          journal.clearJournal({ outcome: 'rolled-back' })
        } catch (clearError) {
          rememberLog(`Journal clear after rollback was unverifiable: ${clearError.message || clearError}`)
        }
        throw new Error(
          `עדכון Hermes נכשל; ההתקנה שוחזרה לגרסה הקודמת (${String(outcome.commit).slice(0, 10)}) והמערכת פועלת. פרטים: ${original}`
        )
      }
      // Not fully restored/healthy → LEAVE the journal for launch-time recovery
      // and fail closed with the verified backup path + honest support copy.
      throw new Error(outcome.restored ? original : outcome.message)
    }

    // Failure BEFORE any mutation (method gate / offline / target preflight /
    // stop / backup verification): nothing on the checkout changed. Bring the
    // runtime back up and — if a journal was opened — clear it (there is nothing
    // incomplete on disk). An unverifiable clear here is safe to leave for the
    // next launch, so it is logged rather than masking the real abort reason.
    await recoverRuntime(command, deps).catch(recoveryError => {
      rememberLog(`Post-preflight recovery failed: ${recoveryError.message || recoveryError}`)
    })
    if (began) {
      try {
        journal.clearJournal({ outcome: 'aborted-before-mutation' })
      } catch (clearError) {
        rememberLog(`Journal clear after pre-mutation abort was unverifiable: ${clearError.message || clearError}`)
      }
    }
    throw new Error(`עדכון Hermes נכשל: ${original}`)
  }

  // Reached ONLY on success (every branch of the catch above throws). Clearing
  // the durable journal is the final step and lives OUTSIDE the rollback-guarded
  // try so an undeletable journal can never trigger a destructive rollback of a
  // healthy, correctly-versioned install. It is still VERIFIABLE: clearJournal
  // throws if it cannot confirm the active journal is gone, and we surface that
  // honestly instead of reporting a plain success while a journal survives.
  try {
    journal.clearJournal({ outcome: 'completed' })
  } catch (clearError) {
    rememberLog(`Update applied but journal clear was unverifiable: ${clearError.message || clearError}`)
    throw new Error(
      `עדכון Hermes הותקן ואומת, אך ניקוי יומן העדכון נכשל (${clearError.message || clearError}); ` +
        'הניקוי יושלם בהפעלה הבאה.'
    )
  }
  return success
}

module.exports = { runOfficialUpdate, stopOfficialSurfaces, recoverRuntime, closeDesktopScript }
