// Packaged-companion ISOLATED E2E — thin orchestrator.
//
// Boots the freshly built companion against a throwaway HERMES_HOME on an
// isolated loopback port (the QA side of the electron/qa-runtime.cjs contract),
// proves the live Hermes profile is never touched, and — opt-in via
// HERMES_BUSINESS_E2E_APPROVAL=1 — drives a REAL, denied approval end-to-end over
// the official gateway RPC/event path. The harness owns the temp home (create →
// own → delete) and emits one redactable JSON report on stdout. The attestation
// gate, isolation case, approval case and teardown/forensics live in
// scripts/lib/isolated-e2e/.

import os from 'node:os'
import path from 'node:path'
import { safeJson } from './lib/e2e-harness.mjs'
import { repoRoot } from './lib/build-attestation.mjs'
import {
  launchInstalledApp,
  openFirstWindow,
  tempUserDataDir,
  waitForRuntimeRunning
} from './lib/installed-app.mjs'
import { verifyBoot } from './lib/probes/installed/boot.mjs'
import {
  chooseIsolatedPort,
  createTempHermesHome,
  isolatedLaunchEnv,
  liveHermesHome,
  removeTempHome
} from './lib/isolated-runtime.mjs'
import { hermesHomeMarker } from './lib/isolated-marker.mjs'
import { resolveAttestedArtifact } from './lib/isolated-e2e/attestation-gate.mjs'
import { runApprovalCase } from './lib/isolated-e2e/approval-case.mjs'
import { captureOwnedRecords, readOwnedGatewayPid } from './lib/isolated-e2e/gateway-process.mjs'
import { assessAndGateIsolation, computeRunVerdict } from './lib/isolated-e2e/isolation-run.mjs'
import { finalizeTeardown } from './lib/isolated-e2e/teardown.mjs'
import { reapProcessTree } from '../electron/process-util.cjs'

const runApproval = process.env.HERMES_BUSINESS_E2E_APPROVAL === '1'
// AUTOMATED EXACT-ARTIFACT capture: the orchestrator injects the immutable staged
// artifact's build_nonce here; the harness proves the RUNNING app echoed that exact
// nonce (== the attested artifact) and surfaces it so the orchestrator can machine-
// capture the binding. Absent (standalone run) → exact_staged_artifact stays null.
const injectedStagedNonce = process.env.HERMES_EXACT_STAGED_ARTIFACT || null
const liveHome = liveHermesHome()
// Snapshot the live profile-defining marker BEFORE anything runs.
const liveMarkerBefore = hermesHomeMarker(liveHome)

const tempHome = createTempHermesHome()
const isolatedPort = await chooseIsolatedPort()
const probePath = path.join(os.tmpdir(), `hermes-iso-approval-probe-${process.pid}.txt`)

const root = repoRoot()
const report = {
  ok: false,
  mode: 'qa-isolated',
  app_version_source: 'packaged',
  artifact_attested: false,
  artifact_kind: null,
  qa_namespace_applied: false,
  artifact: {},
  running_nonce: null,
  exact_staged_artifact: injectedStagedNonce ? false : null,
  isolation: {},
  approval: runApproval ? { enabled: true } : { enabled: false },
  teardown: {}
}

// ── ARTIFACT ATTESTATION GATE (fail BEFORE launch) ───────────────────────────
let executablePath
let appDirectory
let expectedNonce = null
try {
  const gate = resolveAttestedArtifact({ root })
  report.artifact = gate.artifact
  if (!gate.ok) {
    report.error = gate.error
    report.teardown = { aborted_before_launch: true }
    await removeTempHome(tempHome)
    console.log(safeJson(report))
    process.exit(1)
  }
  report.artifact_attested = true
  report.artifact_kind = gate.artifactKind
  expectedNonce = gate.expectedNonce
  executablePath = gate.executablePath
  appDirectory = gate.appDirectory
} catch (error) {
  report.error = String(error?.message || error)
  report.teardown = { aborted_before_launch: true }
  await removeTempHome(tempHome)
  console.log(safeJson(report))
  process.exit(1)
}

const { HERMES_HOME, ...cleanEnv } = process.env // never let a stray HERMES_HOME leak in
const launchEnv = { ...cleanEnv, ...isolatedLaunchEnv({ home: tempHome, port: isolatedPort }) }
// Run-unique userData path: hoisted so teardown can use it as a command-line
// ownership marker of last resort (a launch that dies before we hold a PID).
const userDataDir = tempUserDataDir('hermes-iso-e2e')

let electronApp = null
let electronProcess = null
// Identity records (creation date + exe) of every process this run owns. The
// spawned `gateway run` python reuses the LIVE install's venv binary and its
// command line carries NO temp-home marker, so a snapshot taken by descent
// while the tree is alive is the only reliable post-mortem handle on it.
let ownedProcs = null
try {
  electronApp = await launchInstalledApp({
    executablePath,
    appDirectory,
    userDataDir,
    env: launchEnv
  })
  electronProcess = electronApp.process()
  ownedProcs = captureOwnedRecords({
    prior: ownedProcs,
    rootPids: [electronProcess.pid],
    cmdlineMarkers: [userDataDir]
  })
  const { page } = await openFirstWindow(electronApp)
  await verifyBoot({ page, consoleMessages: [], pageErrors: [], screenshotPath: path.join(os.tmpdir(), `hermes-iso-boot-${process.pid}.png`) })

  const runtime = await waitForRuntimeRunning(page)
  // The gateway tree exists NOW (venv launcher + python, possibly already
  // detached from Electron) and the profile-owned PID record is written —
  // refresh the identity snapshot to cover both roots.
  ownedProcs = captureOwnedRecords({
    prior: ownedProcs,
    rootPids: [electronProcess.pid, readOwnedGatewayPid(tempHome)],
    cmdlineMarkers: [userDataDir]
  })
  // Assess isolation and run both fail-fast gates (structural, then the tested
  // four-invariant set) BEFORE any session/prompt/credential-seed/approval.
  const assess = await assessAndGateIsolation({
    page,
    runtime,
    isolatedPort,
    tempHome,
    expectedNonce,
    liveMarkerBefore,
    report
  })
  // Surface the nonce the RUNNING app echoed and whether it is the EXACT injected
  // staged artifact (injected == attested manifest nonce == running-app nonce).
  report.running_nonce = assess.runningNonce || null
  if (injectedStagedNonce) {
    report.exact_staged_artifact = Boolean(
      injectedStagedNonce === expectedNonce &&
        assess.runningNonce &&
        assess.runningNonce === expectedNonce
    )
  }

  if (runApproval) {
    report.approval = await runApprovalCase({ page, liveHome, tempHome, probePath })
  }

  report.ok = computeRunVerdict({ report, runApproval })
} catch (error) {
  report.error = String(error?.message || error)
} finally {
  // Refresh the owned-identity snapshot while the tree is still walkable (late
  // children included), THEN reap the full Electron → Hermes serve child tree
  // before deleting the isolated home. A graceful window close can return before
  // the venv Python grandchild releases Windows file handles, making teardown
  // nondeterministically fail.
  ownedProcs = captureOwnedRecords({
    prior: ownedProcs,
    rootPids: [electronProcess?.pid, readOwnedGatewayPid(tempHome)],
    cmdlineMarkers: [userDataDir]
  })
  if (electronProcess) reapProcessTree(electronProcess)
  try {
    if (electronApp) await electronApp.close()
  } catch {
    /* ignore */
  }
  // Reap the port, VERIFY every owned identity is dead (force-kill survivors,
  // interleaving kill rounds with temp-home removal retries), re-snapshot the
  // live marker and derive the teardown verdict (mutates report.teardown +
  // report.ok). If the live profile's defining state moved, a redacted forensic
  // report is preserved.
  await finalizeTeardown({
    report,
    tempHome,
    isolatedPort,
    liveHome,
    liveMarkerBefore,
    probePath,
    forensicDir: path.join(root, 'docs', 'evidence', 'forensics'),
    runApproval,
    ownedProcs
  })
}

console.log(safeJson(report))
process.exit(report.ok ? 0 : 1)
