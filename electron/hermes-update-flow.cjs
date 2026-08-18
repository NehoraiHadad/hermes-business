const { stopOfficialSurfaces, recoverRuntime, closeDesktopScript } = require('./update-runtime.cjs')

// Pure orchestration of the official Hermes self-update. Every side-effecting
// collaborator (process spawns, runtime lifecycle, backup, rollback, health
// probes, the on-disk journal) is passed in via `deps`, so the exact ordering —
// preflight → begin journal → stop → backup → mutate → recover(both healths) →
// verify → clear, with a bounded rollback on post-mutation failure — is
// unit-testable without a live Hermes, git checkout, or Electron.
// `hermes-update.cjs` wires the real collaborators; tests inject fakes. The
// runtime-lifecycle helpers that bracket the transaction (stopOfficialSurfaces,
// recoverRuntime) live in update-runtime.cjs. Note that stopOfficialSurfaces is
// used TWICE: once before the mutation, and once after a rollback — a rollback
// only rewrites the checkout, so the surfaces must be restarted from the restored
// code before any health proof about it can be honest.

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
    // AUTHORITATIVE `hermes gateway status` reader, used to PROVE the old gateway
    // is gone after the post-rollback stop. Wired in hermes-update.cjs like every
    // other side-effecting collaborator; an unwired one throws, which fails closed
    // (see the post-rollback branch).
    gatewayState,
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
    // 3. A git install must not silently cross the tested 0.21 boundary.
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
        // STOP BEFORE RECOVERING, or the health proof below covers the WRONG CODE.
        //
        // rollbackAfterFailedUpdate resets the git checkout and stops NOTHING. So
        // whatever is running at this instant is still executing the code we just
        // reverted, and both halves of recoverRuntime are no-ops against it:
        // ensureGatewayBackground returns early when a gateway is already running,
        // and startHermes() returns early on `if (state.running) return state`.
        // Without this stop, recoverRuntime would prove "both healths pass" about
        // processes running the reverted code, and getHermesVersion(command) reads
        // the CHECKOUT, so nothing downstream could notice the discrepancy.
        //
        // The sharpest case is the post-update version re-gate: the flow starts the
        // new code, finds the landed version unsupported, reverts the checkout,
        // re-verifies against those same still-running unsupported-version
        // processes, and tells the owner
        // "ההתקנה שוחזרה לגרסה הקודמת והמערכת פועלת". On disk that is true; in
        // memory the rejected version is still the thing serving the user. A
        // rollback that leaves the rejected code running and then reports success is
        // worse than one that fails loudly. This repo does not call anything healthy
        // without a proof that covers what is ACTUALLY RUNNING, and before this stop
        // the proof did not cover it.
        //
        // UNCONDITIONAL, not "only where needed". When `update --yes` itself threw,
        // the surfaces are already down from the pre-mutation stop and this is a
        // pure no-op (stopHermes() is `if (!proc) return`; `gateway stop --all` on a
        // stopped gateway is caught and logged inside stopOfficialSurfaces; the
        // Windows sweep finds no process under the install root). Making it
        // conditional would require the flow to know whether the FIRST recoverRuntime
        // got far enough to restart anything before it threw — which is not
        // observable from here without inventing state. So we do not guess: the cost
        // of a redundant stop is a few seconds on an already-failing path, while the
        // cost of wrongly skipping one is the false claim above.
        //
        // It is also the repo's ONE stop path, the same helper the pre-mutation phase
        // uses — no second stop mechanism is invented for the rollback.
        //
        // FAILURE HANDLING IS DELIBERATELY STRICTER HERE than in companion-apply.cjs,
        // where a failed gateway stop is logged and the update proceeds. There, the
        // stop is not a precondition for anything that follows (the installer replaces
        // files regardless, and the journal already records the transaction). Here the
        // stop is exactly what makes the following health proof MEAN anything, so a
        // stop we could not complete leaves us unable to prove the restore. It sits
        // INSIDE this try on purpose: a throw leaves `recovered` false, the journal is
        // PRESERVED for launch-time recovery, and the honest original/fail-closed
        // message is what reaches the owner — never a success claim we cannot back.
        await stopOfficialSurfaces(command, deps)
        // ...and PROVE the old gateway is actually gone before trusting the restart.
        //
        // stopOfficialSurfaces swallows a failed `gateway stop --all` on purpose
        // (`.catch(log)`): during the PRE-mutation phase a noisy stop must not abort
        // an update. That swallow is correct there and is deliberately left alone —
        // the extra strictness belongs to THIS call site only, which is why the
        // verification lives next to the call rather than inside the helper.
        //
        // Here the consequence of a silently-failed stop is specific and bad: the old
        // gateway survives, ensureGatewayBackground early-returns because it is still
        // running, and the deep assertion then certifies the code we just REVERTED —
        // the exact false claim the stop above exists to prevent, arriving through the
        // one door the stop cannot close by itself.
        //
        // `unknown` fails closed with `running`, and that is not pedantry: the reader
        // returns `unknown` when the command is missing, the spawn failed, or the
        // output was unparseable. "We could not look" is not "it is not there", and
        // this is the same rule the WhatsApp guard activation path already applies to
        // this same reader. Anything other than a POSITIVE `stopped` means we cannot
        // prove the restore, so we do not claim it: throwing here leaves `recovered`
        // false, preserves the journal for launch-time recovery, and surfaces the
        // original error — never a success we cannot back.
        const afterStop = gatewayState({ command })
        if (afterStop.state !== 'stopped') {
          throw new Error(
            `gateway still reports "${afterStop.state}" after the post-rollback stop${afterStop.reason ? ` (${afterStop.reason})` : ''}; the restored code cannot be verified`
          )
        }
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
