const path = require('node:path')

// Pure orchestration of the official Hermes self-update. Every side-effecting
// collaborator (process spawns, runtime lifecycle, backup, rollback) is passed
// in via `deps`, so the exact ordering — preflight → stop → backup → mutate →
// recover, with a bounded rollback on post-mutation failure — is unit-testable
// without a live Hermes, git checkout, or Electron. `hermes-update.cjs` wires
// the real collaborators; tests inject fakes.

const closeDesktopScript = String.raw`
$root = [IO.Path]::GetFullPath($env:HERMES_UPDATE_ROOT).TrimEnd('\') + '\'
$targets = @(Get-CimInstance Win32_Process | Where-Object {
  $exe = [string]$_.ExecutablePath
  $cmd = [string]$_.CommandLine
  $inside = $exe.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)
  $desktop = $cmd -match '(?i)(^|\s)desktop(\s|$)' -or $exe -match '(?i)\\apps\\desktop\\release\\'
  $inside -and $desktop
})
foreach ($target in ($targets | Sort-Object ProcessId -Descending)) {
  Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 800
Write-Output $targets.Count
`

async function stopOfficialSurfaces(command, deps) {
  const { stopHermes, runCaptured, rememberLog, platform = process.platform } = deps
  await stopHermes()
  await runCaptured(command, ['gateway', 'stop', '--all'], 90_000).catch(error => {
    rememberLog(`Gateway stop before update returned: ${error.message || error}`)
  })
  if (platform !== 'win32') return
  // The executable being replaced is under this install root; close only the
  // Hermes Desktop processes running from inside it (never unrelated apps).
  const root = path.resolve(command, '..', '..', '..')
  await runCaptured(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', closeDesktopScript],
    45_000,
    { HERMES_UPDATE_ROOT: root }
  )
}

async function recoverRuntime(command, deps) {
  const { ensureGatewayBackground, startHermes, hermesApi } = deps
  await ensureGatewayBackground(command)
  const runtime = await startHermes()
  if (!runtime.running) throw new Error(runtime.error || 'Hermes did not restart after update')
  const health = await hermesApi('/api/health')
  if (!health?.ok) throw new Error('Hermes failed its post-update health check')
  return { runtime, health }
}

async function runOfficialUpdate(deps) {
  const {
    findHermes,
    getHermesVersion,
    runCaptured,
    rememberLog,
    assertUpdateMethodSupported,
    assertUpdateTargetSupported,
    assertRunningVersionSupported,
    createPreUpdateBackup,
    captureRollbackAnchor,
    rollbackAfterFailedUpdate
  } = deps

  const command = findHermes()
  if (!command) throw new Error('Hermes אינו מותקן')

  let updated = false
  let backupPath = null
  let anchor = null

  try {
    // --- PREFLIGHT (before stopping anything / before any backup) ---
    // 1. Gate an install method we can neither preflight nor recover.
    assertUpdateMethodSupported(command)
    // 2. Hermes' own read-only eligibility probe (never mutates).
    await runCaptured(command, ['update', '--check'], 5 * 60_000).catch(error => {
      rememberLog(`update --check before preflight returned: ${error.message || error}`)
    })
    // 3. A git install must not silently cross the tested 0.20 boundary.
    assertUpdateTargetSupported(command)
    // 4. Capture the exact commit to roll back to — still before any mutation.
    anchor = captureRollbackAnchor(command).anchor

    // --- MUTATION PHASE ---
    await stopOfficialSurfaces(command, deps)
    // Explicit full ZIP backup, verified (central directory parses, non-empty)
    // before we let the update proceed.
    backupPath = await createPreUpdateBackup(command)
    // Mark the mutation boundary BEFORE invoking `update --yes`: once it starts,
    // the checkout may already be dirtied, so ANY failure from here on must go
    // through rollback rather than being treated as a no-op preflight failure.
    updated = true
    await runCaptured(command, ['update', '--yes'], 20 * 60_000)

    const { runtime } = await recoverRuntime(command, deps)
    // POST-UPDATE RE-GATE (authoritative): resolve the version Hermes ACTUALLY
    // runs now and enforce hermes-compat.json before reporting success. The
    // pre-mutation target preflight is only a forward guard (null for non-git or
    // an unreadable origin), so a landed-but-unsupported or unresolvable version
    // must fail here. Throwing routes into the post-mutation branch below, which
    // rolls back to the pre-update anchor — user state (sessions/skills/memories)
    // lives outside the checkout and is never touched.
    const version = getHermesVersion(command)
    assertRunningVersionSupported(version)
    return {
      ok: true,
      completed: true,
      version,
      backupPath,
      runtime
    }
  } catch (error) {
    const original = error.message || String(error)

    if (updated) {
      // Failure AFTER the install was mutated: attempt the safe, bounded
      // rollback (git reset to the anchor; non-git → fail closed).
      const outcome = rollbackAfterFailedUpdate({ command, anchor, backupPath })
      await recoverRuntime(command, deps).catch(recoveryError => {
        rememberLog(`Post-rollback recovery failed: ${recoveryError.message || recoveryError}`)
      })
      if (outcome.restored) {
        throw new Error(
          `עדכון Hermes נכשל; ההתקנה שוחזרה לגרסה הקודמת (${String(outcome.commit).slice(0, 10)}) והמערכת פועלת. פרטים: ${original}`
        )
      }
      // Fail closed with the verified backup path + honest manual-support copy.
      throw new Error(outcome.message)
    }

    // Failure BEFORE any mutation (method gate / target preflight / stop /
    // backup verification): nothing on disk changed. Bring the runtime back up
    // for the user and report the blocker honestly.
    await recoverRuntime(command, deps).catch(recoveryError => {
      rememberLog(`Post-preflight recovery failed: ${recoveryError.message || recoveryError}`)
    })
    throw new Error(`עדכון Hermes נכשל: ${original}`)
  }
}

module.exports = { runOfficialUpdate, stopOfficialSurfaces, recoverRuntime, closeDesktopScript }
