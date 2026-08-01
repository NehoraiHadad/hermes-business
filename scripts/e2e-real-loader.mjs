// OPT-IN REAL loader/UI E2E — launches the ACTUAL installed Hermes Desktop
// (Hermes.exe via Playwright/Electron) against a throwaway, fully-isolated
// HERMES_HOME + userData + cwd + re-homed profile, installs the business-shell
// desktop plugin AND its companion backend, seeds a PAUSED cron job, PROVES
// isolation from the main process/renderer/userData, then asserts (1) the REAL
// renderer runtime-loader rendered the plugin's contributions — the loader
// CONTRACT — and (2) a NORMAL pointer click actually navigates and opens the
// Automations tab — the user-path ACCEPTANCE — reaching the companion backend's
// paused-inclusive door (the seeded paused row renders, no active-only fallback).
//
// Safety: an ALLOWLIST child env re-homes every home/cache/config var into the
// sandbox and drops everything else, so no live profile/credential can leak (see
// real-loader-env). The `hermes://` protocol write the app makes unconditionally
// is snapshot/restored byte-exact with a DURABLE backup (real-loader-protocol);
// owned descendants are reaped by identity (real-loader-procs); the exact temp
// root is removed in finally. SIGINT/SIGTERM run the same cleanup. Never
// process.exit() inside the lifecycle — process.exitCode is set after cleanup.
// Without HERMES_BUSINESS_REAL_LOADER=1 the script does nothing.

import path from 'node:path'
import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { HERMES_COMPAT_RANGE } from './plugin-sdk-contract.mjs'
import { readInstalledVersion, versionInRange } from './lib/hermes-desktop-contract.mjs'
import { safeJson } from './lib/e2e-harness.mjs'
import {
  installBusinessShell,
  installBusinessShellBackend,
  scanDesktopPlugins,
  uninstallBusinessShell,
  uninstallBusinessShellBackend
} from './lib/probes/hermes/plugin-install.mjs'
import {
  createSandbox,
  recoveryRoot,
  removeOwnedDir,
  sweepStaleSandboxes,
  verifyElectronUserDataUsed
} from './lib/probes/hermes/real-loader-fs.mjs'
import { buildChildEnv } from './lib/probes/hermes/real-loader-env.mjs'
import {
  snapshotProtocol,
  restoreProtocol,
  discardBackup,
  recoverStaleProtocolBackups
} from './lib/probes/hermes/real-loader-protocol.mjs'
import { snapshotOwnedProcs, mergeRecords, reapOwned } from './lib/probes/hermes/real-loader-procs.mjs'
import { seedPausedCronJob } from './lib/probes/hermes/real-loader-seed.mjs'
import {
  installPreseedInitScript,
  assertPreseeded,
  proveMainHomeIsolation,
  observeBackendResponse
} from './lib/probes/hermes/real-loader-observe.mjs'
import {
  assertLoaderContribution,
  openBusinessViaPointer,
  assertAutomationsBackend
} from './lib/probes/hermes/real-loader-ui.mjs'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const require = createRequire(import.meta.url)
const { hermesHome, findHermes, getHermesVersion } = require(path.join(repoRoot, 'electron', 'paths.cjs'))

const report = { ok: false, mode: 'real-loader', steps: {}, cleanup: {} }

function finish() {
  console.log(safeJson(report))
}
function blocked(reason, steps = []) {
  report.blocked = { reason, steps }
  if (process.exitCode !== 1) process.exitCode = 3
}
function canonical(p) {
  try {
    return realpathSync.native(p)
  } catch {
    return p
  }
}

await main()
finish()

// ── PRE-LAUNCH GATES (no side effects until run()) ───────────────────────────
async function main() {
  if (process.env.HERMES_BUSINESS_REAL_LOADER !== '1') {
    return blocked('opt-in only: this run launches the real Hermes Desktop and mutates a throwaway home.', [
      'Re-run with HERMES_BUSINESS_REAL_LOADER=1 on a machine with installed Hermes Desktop.'
    ])
  }
  const liveHome = hermesHome()
  const version = readInstalledVersion(liveHome)
  const cliBin = process.env.HERMES_DESKTOP_HERMES || findHermes()
  const desktopExe =
    process.env.HERMES_BUSINESS_DESKTOP_EXE ||
    path.join(liveHome, 'hermes-agent', 'apps', 'desktop', 'release', 'win-unpacked', 'Hermes.exe')

  if (process.platform !== 'win32') {
    return blocked('the safe protocol snapshot/restore + process reaping are implemented for Windows only.')
  }
  if (!version) return blocked(`no installed Hermes Desktop under ${liveHome}. Run the installer/bootstrap first.`)
  if (!versionInRange(version, HERMES_COMPAT_RANGE)) {
    return blocked(`installed Hermes ${version} is outside the supported range ${HERMES_COMPAT_RANGE}.`)
  }
  if (!cliBin || !existsSync(cliBin)) {
    return blocked('installed Hermes CLI (HERMES_DESKTOP_HERMES) not found.', ['Confirm venv/Scripts/hermes.exe exists.'])
  }
  if (!existsSync(desktopExe)) {
    return blocked(`installed Hermes Desktop executable not found: ${desktopExe}`, ['Build/install the desktop app first.'])
  }
  // Attest the ACTUAL binary/CLI identity; compatibility is derived from these
  // real artifacts (installed version + in-range check), never from a claim.
  report.steps.installedVersion = version
  report.steps.compatRange = HERMES_COMPAT_RANGE
  report.steps.cliBin = canonical(cliBin)
  report.steps.cliVersion = getHermesVersion(cliBin) || null
  report.steps.desktopExe = canonical(desktopExe)
  await run({ cliBin, desktopExe: canonical(desktopExe) })
}

async function run({ cliBin, desktopExe }) {
  // Lifecycle state declared BEFORE any resource is created so every branch's
  // cleanup sees the same handles (Fix: try starts before sandbox creation).
  let sandbox = null
  let electronApp = null
  let ownedProcs = { ok: true, records: [] }
  let protocolSnapshot = null
  let backupFile = null
  let cleaned = false
  const recovery = recoveryRoot()

  const doCleanup = () => cleanup({ getState: () => ({ sandbox, electronApp, ownedProcs, protocolSnapshot, backupFile, desktopExe }), setCleaned: () => (cleaned = true), isCleaned: () => cleaned })

  const onSignal = sig => {
    report.signal = sig
    try {
      doCleanup()
    } finally {
      finish()
      process.exit(report.ok ? 0 : 1)
    }
  }
  process.once('SIGINT', () => onSignal('SIGINT'))
  process.once('SIGTERM', () => onSignal('SIGTERM'))

  try {
    // Idempotent crash-recovery watchdog + generic stale-sandbox sweep FIRST, so a
    // prior aborted run's registry write is undone and its temp roots reclaimed.
    report.cleanup.protocolRecovery = recoverStaleProtocolBackups(recovery, { handlerHint: desktopExe })
    report.cleanup.staleSweep = sweepStaleSandboxes({})

    sandbox = createSandbox('hermes-realloader-')
    report.steps.sandbox = sandbox.root

    const receipt = installBusinessShell(sandbox.hermesHome)
    const backend = installBusinessShellBackend(sandbox.hermesHome)
    if (!scanDesktopPlugins(sandbox.hermesHome).some(p => p.name === 'business-shell')) {
      throw new Error('disk-door install did not land business-shell in the isolated home')
    }
    report.steps.pluginInstalled = { integrity: receipt.integrity, backendNamespace: backend.namespace }

    // Seed a PAUSED cron job so the paused-inclusive door has something only IT can
    // surface (the active-only fallback filters paused jobs out).
    const seeded = seedPausedCronJob(sandbox.hermesHome)
    report.steps.seededPausedJob = { id: seeded.id, name: seeded.name }

    // Snapshot the hermes:// protocol subtree to a DURABLE backup OUTSIDE the
    // deletable sandbox; fail closed if it can't be captured exactly.
    backupFile = path.join(recovery, `hermes-protocol-${path.basename(sandbox.root)}.reg`)
    protocolSnapshot = snapshotProtocol({ backupFile })
    report.steps.protocolSnapshot = { ok: protocolSnapshot.ok, existed: protocolSnapshot.existed, backupFile }
    if (!protocolSnapshot.ok) {
      blocked('could not snapshot the hermes:// protocol registry; refusing to launch (fail closed).', [
        protocolSnapshot.error || 'reg export failed'
      ])
      return
    }

    const env = buildChildEnv({ base: process.env, sandbox, cliBin })
    electronApp = await electron.launch({
      executablePath: desktopExe,
      args: [`--user-data-dir=${sandbox.userData}`],
      cwd: sandbox.cwd,
      env,
      timeout: 180_000
    })

    // Snapshot owned descendants by identity while alive; fail closed if we cannot
    // enumerate them (we must be able to prove containment at teardown).
    ownedProcs = snapshotOwnedProcs(electronApp.process().pid)
    if (!ownedProcs.ok) throw new Error(`could not enumerate owned processes (fail closed): ${ownedProcs.error}`)
    report.steps.ownedPidCount = ownedProcs.records.length

    // Preseed via init script BEFORE navigation, then reload so it runs for this
    // document, then PROVE it took (fail honestly if not).
    await installPreseedInitScript(electronApp.context())
    const page = await electronApp.firstWindow({ timeout: 90_000 })
    await page.waitForLoadState('domcontentloaded')
    await page.reload({ waitUntil: 'domcontentloaded' })
    report.steps.preseed = await assertPreseeded(page)

    // Isolation proofs BEFORE any UI claim.
    report.steps.isolation = (await proveMainHomeIsolation(page, { isoHome: sandbox.hermesHome })).values
    const userData = verifyElectronUserDataUsed(sandbox.userData)
    report.steps.userDataIsolation = userData
    if (!userData.used) {
      throw new Error(`Electron did not use the isolated userData dir ${sandbox.userData} (no known marker present)`)
    }

    // (1) CONTRACT proof — loader ran + rendered the nav contribution.
    report.steps.loaderContract = await assertLoaderContribution(page)

    // Observe the namespaced backend response (bonus attestation).
    const backendObs = observeBackendResponse(page, { pathFragment: '/api/plugins/business-shell/cron/jobs' })

    // (2) CLICK-PATH acceptance — a real user-input affordance (sidebar pointer
    //     click, else the official ⌘/Ctrl+K command palette by keyboard) opens
    //     the page + Automations tab + reaches the paused-inclusive backend door.
    report.steps.clickPath = await openBusinessViaPointer(page)
    report.steps.automations = await assertAutomationsBackend(page, { seededJobName: seeded.name })
    report.steps.backendResponse = {
      observed2xx: Boolean(backendObs.matched2xx()),
      pausedSupportedBody: Boolean(backendObs.pausedSupportedBody()),
      note: backendObs.hits.length ? undefined : 'no renderer-visible response (door may be main-process); paused row is the proof'
    }

    // Final acceptance requires a REAL user-input click-path (pointer OR
    // keyboard), not just the contract or a hash-router diagnostic.
    const clickPathOk = report.steps.clickPath.clickPathOk && report.steps.automations.tabClickOk
    if (!clickPathOk) {
      report.productBug = {
        kind: 'ui-hit-test',
        message:
          'Loader CONTRACT passed but NO official user-input affordance (sidebar nav pointer click ' +
          'OR the ⌘/Ctrl+K command palette) could navigate/open the tab. Hermes UI hit-testing ' +
          'appears broken — reporting a product bug, not a contract-only pass.',
        clickPath: report.steps.clickPath,
        tabClickOk: report.steps.automations.tabClickOk
      }
      blocked('user-path acceptance failed: no official pointer/keyboard path reached the page (contract-only).')
      return
    }
    report.ok = true
  } catch (error) {
    report.error = String(error?.message || error)
    process.exitCode = 1
  } finally {
    doCleanup()
  }
}

// Every step is independently attempted; durable recovery artifacts are preserved
// when the registry restore is not verified exact. Idempotent (guarded so the
// signal path and the finally path don't double-run).
function cleanup({ getState, setCleaned, isCleaned }) {
  if (isCleaned()) return
  setCleaned()
  const { sandbox, electronApp, ownedProcs, protocolSnapshot, backupFile, desktopExe } = getState()

  // Refresh owned descendants IMMEDIATELY before close to catch late children,
  // merging with the alive-snapshot (prior identity wins on PID conflict).
  let records = ownedProcs?.records || []
  if (electronApp) {
    try {
      const refreshed = snapshotOwnedProcs(electronApp.process().pid)
      if (refreshed.ok) records = mergeRecords(records, refreshed.records)
    } catch {
      /* keep the alive-snapshot */
    }
  }
  try {
    if (electronApp) {
      // close() returns a promise; we cannot await in this sync finally-safe path,
      // so we rely on identity-checked reaping below to guarantee containment.
      electronApp.close().catch(() => undefined)
    }
  } catch {
    /* ignore */
  }
  try {
    report.cleanup.processes = reapOwned(records)
  } catch (e) {
    report.cleanup.processes = { allExited: false, error: String(e?.message || e) }
  }

  // Restore the protocol subtree byte-exact; preserve the durable backup unless
  // the restore is verified (never claim ok / never drop the only backup on fail).
  try {
    const restore = restoreProtocol(protocolSnapshot, { handlerHint: desktopExe })
    report.cleanup.protocol = restore
    if (restore.restored && restore.preserveBackup === false && backupFile) {
      discardBackup(backupFile)
    } else if (backupFile) {
      report.cleanup.protocol.backupPreservedAt = backupFile
    }
  } catch (e) {
    report.cleanup.protocol = { restored: false, error: String(e?.message || e), backupPreservedAt: backupFile }
  }

  try {
    if (sandbox) uninstallBusinessShellBackend(sandbox.hermesHome)
  } catch {
    /* ignore */
  }
  try {
    if (sandbox) uninstallBusinessShell(sandbox.hermesHome)
  } catch {
    /* ignore */
  }
  try {
    report.cleanup.tempRoot = sandbox ? removeOwnedDir(sandbox.root) : { removed: true }
  } catch (e) {
    report.cleanup.tempRoot = { removed: false, error: String(e?.message || e) }
  }

  // Any failed containment or an unverified registry restore fails the whole run.
  const procsOk = report.cleanup.processes?.allExited === true
  const protocolOk = report.cleanup.protocol?.restored === true
  const tempOk = report.cleanup.tempRoot?.removed === true
  if (!procsOk || !protocolOk || !tempOk) {
    report.ok = false
    if (process.exitCode !== 3) process.exitCode = 1
  }
}
